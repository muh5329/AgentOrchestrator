import { eq, sql } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { executions as executionsTable } from '../db/schema'
import type { InvokeAgentResult, TaskStatus } from '../../shared/domain'
import { now, sleep } from '../util/time'
import type { ExecutionResult } from '../runtime/agent-runtime'

interface RunningEntry {
  taskId: string
  executionId: string
  agentId: string
  controller: AbortController
  startedAt: number
  nested: boolean
}

export interface ExecutionManagerOptions {
  globalConcurrency?: number
  tickMs?: number
}

/**
 * Decides what runs, when, and what happens to the result.
 *
 * The runtime knows how to execute one agent; this decides which agent gets a
 * slot, enforces concurrency, applies retry policy, and hands finished work to
 * the Judge. Nested invocations (`invoke_agent`) deliberately bypass the
 * concurrency gate: the caller is already holding a slot and waiting on the
 * callee, so making the callee queue behind it would deadlock.
 */
export class ExecutionManager {
  private readonly running = new Map<string, RunningEntry>()
  /**
   * One task, one execution. The queue and a synchronous `invoke_agent` can
   * reach the same task in the same tick; without this they would both start it.
   */
  private readonly inflight = new Map<string, Promise<ExecutionResult>>()
  /** Projects currently being signed off, so the review runs once. */
  private readonly projectReviews = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private draining = false
  private stopped = true
  private readonly globalConcurrency: number
  private readonly tickMs: number

  constructor(
    private readonly ctx: AppContext,
    options: ExecutionManagerOptions = {}
  ) {
    this.globalConcurrency = options.globalConcurrency ?? 8
    this.tickMs = options.tickMs ?? 500
  }

  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => this.drain(), this.tickMs)
    // Nudge the queue whenever something might have become runnable. Deferred
    // so the emitting service finishes its own work before we act on it.
    const nudge = (): void => {
      setImmediate(() => this.drain())
    }
    this.ctx.bus.on('TASK_UPDATED', nudge)
    this.ctx.bus.on('TASK_CREATED', nudge)
    this.ctx.bus.on('TASK_COMPLETED', nudge)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const entry of this.running.values()) entry.controller.abort()
    const deadline = Date.now() + 5000
    // `running` is cleared before settle() judges, retries and records project
    // completion, so waiting on it alone lets shutdown close the database while
    // those writes are still in flight. `inflight` spans the whole execution.
    while ((this.running.size || this.inflight.size) && Date.now() < deadline) {
      await sleep(50)
    }
  }

  get activeCount(): number {
    return [...this.running.values()].filter((r) => !r.nested).length
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId)
  }

  runningEntries(): Array<Omit<RunningEntry, 'controller'>> {
    return [...this.running.values()].map(({ controller: _c, ...rest }) => rest)
  }

  /** Picks up everything that has become runnable and starts what it can. */
  private drain(): void {
    if (this.draining || this.stopped) return
    this.draining = true
    try {
      if (this.activeCount >= this.globalConcurrency) return
      const candidates = this.ctx.tasks.ready()
      for (const task of candidates) {
        if (this.stopped) break
        if (this.activeCount >= this.globalConcurrency) break
        if (this.running.has(task.id)) continue
        if (!task.agentId) continue

        const agent = this.ctx.agents.find(task.agentId)
        if (!agent) continue
        if (['PAUSED', 'DISABLED', 'FAILED'].includes(agent.status)) continue

        const project = this.ctx.projects.find(task.projectId)
        if (!project || project.status === 'PAUSED' || project.status === 'ARCHIVED') continue

        const perProject = [...this.running.values()].filter(
          (r) => this.ctx.tasks.find(r.taskId)?.projectId === task.projectId && !r.nested
        ).length
        if (perProject >= project.settings.limits.maxConcurrentExecutions) continue

        this.ctx.tasks.setStatus(task.id, 'QUEUED')
        void this.execute(task.id, { nested: false })
      }
    } finally {
      this.draining = false
    }
  }

  /** Runs a task immediately and waits for it - used by invoke_agent. */
  async runTaskNow(
    taskId: string,
    options: { parentExecutionId?: string; depth?: number; signal?: AbortSignal } = {}
  ): Promise<InvokeAgentResult> {
    const result = await this.execute(taskId, {
      nested: true,
      parentExecutionId: options.parentExecutionId,
      depth: options.depth,
      parentSignal: options.signal
    })
    const task = this.ctx.tasks.get(taskId)
    const evaluation = this.ctx.evaluations.latestForTask(taskId)
    return {
      status: result.status === 'completed' ? 'completed' : result.status === 'blocked' ? 'blocked' : 'failed',
      summary: result.summary,
      artifacts: this.ctx.artifacts
        .listByTask(taskId)
        .map((a) => ({ id: a.id, title: a.title, path: a.path ?? undefined })),
      issues: evaluation?.issues ?? [],
      score: task.score == null ? null : task.score / 100,
      taskId,
      executionId: result.executionId
    }
  }

  /** Immediately queues a task, bypassing the readiness scan. */
  enqueue(taskId: string): void {
    const task = this.ctx.tasks.get(taskId)
    if (!task.agentId) throw new Error('Cannot run a task with no agent assigned.')
    if (this.running.has(taskId)) return
    this.ctx.tasks.setStatus(taskId, 'QUEUED')
    void this.execute(taskId, { nested: false })
  }

  cancel(taskId: string): boolean {
    const entry = this.running.get(taskId)
    if (!entry) return false
    entry.controller.abort()
    return true
  }

  recordToolCall(executionId: string): void {
    this.ctx.db
      .update(executionsTable)
      .set({
        toolCallCount: sql`${executionsTable.toolCallCount} + 1`,
        heartbeatAt: now()
      })
      .where(eq(executionsTable.id, executionId))
      .run()
  }

  private execute(
    taskId: string,
    options: {
      nested: boolean
      parentExecutionId?: string
      depth?: number
      parentSignal?: AbortSignal
    }
  ): Promise<ExecutionResult> {
    const existing = this.inflight.get(taskId)
    if (existing) return existing
    const promise = this.executeOnce(taskId, options).finally(() => {
      this.inflight.delete(taskId)
    })
    this.inflight.set(taskId, promise)
    return promise
  }

  private async executeOnce(
    taskId: string,
    options: {
      nested: boolean
      parentExecutionId?: string
      depth?: number
      parentSignal?: AbortSignal
    }
  ): Promise<ExecutionResult> {
    const task = this.ctx.tasks.get(taskId)
    const agentId = task.agentId
    if (!agentId) {
      throw new Error(`Task ${taskId} has no agent assigned.`)
    }

    const controller = new AbortController()
    if (options.parentSignal) {
      if (options.parentSignal.aborted) controller.abort()
      else options.parentSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    const entry: RunningEntry = {
      taskId,
      executionId: '',
      agentId,
      controller,
      startedAt: now(),
      nested: options.nested
    }
    this.running.set(taskId, entry)

    let result: ExecutionResult
    try {
      result = await this.ctx.runtime.run({
        taskId,
        agentId,
        parentExecutionId: options.parentExecutionId ?? null,
        depth: options.depth,
        attempt: task.attempt,
        signal: controller.signal
      })
      entry.executionId = result.executionId
    } catch (err) {
      this.running.delete(taskId)
      const message = (err as Error).message
      this.ctx.tasks.setStatus(taskId, 'FAILED', { error: message })
      throw err
    }

    this.running.delete(taskId)

    try {
      await this.settle(taskId, result)
    } catch (err) {
      this.ctx.bus.emit({
        type: 'SYSTEM',
        projectId: task.projectId,
        taskId,
        level: 'error',
        message: `Post-execution handling failed: ${(err as Error).message}`
      })
    }

    return result
  }

  /** Applies policy to a finished execution: judge, retry, block or complete. */
  private async settle(taskId: string, result: ExecutionResult): Promise<void> {
    const task = this.ctx.tasks.get(taskId)
    const settings = this.ctx.projects.settings(task.projectId)

    if (result.status === 'cancelled') {
      this.ctx.tasks.setStatus(taskId, 'CANCELLED', { error: 'Cancelled' })
      return
    }

    if (result.status === 'blocked') {
      this.ctx.tasks.setStatus(taskId, 'BLOCKED', { blockedReason: result.summary })
      const agent = this.ctx.agents.get(task.agentId as string)
      if (agent.parentAgentId) {
        this.ctx.messages.send({
          projectId: task.projectId,
          fromAgentId: agent.id,
          toAgentId: agent.parentAgentId,
          taskId,
          type: 'HELP_REQUEST',
          priority: 80,
          content: `I am blocked on "${task.title}": ${result.summary}`
        })
      } else {
        this.ctx.approvals.request({
          projectId: task.projectId,
          agentId: agent.id,
          taskId,
          action: `Unblock "${task.title}"`,
          reason: result.summary
        })
      }
      return
    }

    if (result.status === 'failed') {
      await this.handleFailure(taskId, result)
      return
    }

    // Completed. Nothing is finished until the Judge says so.
    if (!task.requiresJudge || !settings.autoJudge) {
      this.ctx.tasks.setStatus(taskId, 'COMPLETED', {
        result: { summary: result.summary, executionId: result.executionId }
      })
      await this.checkProjectCompletion(task.projectId)
      return
    }

    this.ctx.tasks.setStatus(taskId, 'REVIEW', {
      result: { summary: result.summary, executionId: result.executionId }
    })
    await this.ctx.judge.evaluate(taskId, { executionId: result.executionId, apply: true })
    await this.checkProjectCompletion(task.projectId)
  }

  private async handleFailure(taskId: string, result: ExecutionResult): Promise<void> {
    const task = this.ctx.tasks.get(taskId)
    const policy = task.retryPolicy ?? { maxRetries: 2, backoffMs: 5000, backoffFactor: 2 }
    const attempt = task.attempt + 1

    if (attempt <= policy.maxRetries) {
      const delay = policy.backoffMs * Math.pow(policy.backoffFactor, attempt - 1)
      this.ctx.tasks.update(taskId, { attempt, error: result.error ?? result.summary })
      this.ctx.bus.emit({
        type: 'TASK_RETRY',
        projectId: task.projectId,
        taskId,
        agentId: task.agentId,
        level: 'warn',
        message: `Retrying "${task.title}" (attempt ${attempt} of ${policy.maxRetries}) in ${Math.round(delay / 1000)}s`,
        data: { attempt, delay, error: result.error }
      })
      setTimeout(() => {
        const current = this.ctx.tasks.find(taskId)
        if (!current || ['CANCELLED', 'COMPLETED'].includes(current.status)) return
        this.ctx.tasks.setStatus(taskId, 'READY', { error: null })
      }, delay)
      return
    }

    this.ctx.tasks.setStatus(taskId, 'FAILED', { error: result.error ?? result.summary })

    // Out of retries: escalate rather than silently stopping.
    const agent = this.ctx.agents.find(task.agentId ?? '')
    if (agent?.parentAgentId) {
      this.ctx.messages.send({
        projectId: task.projectId,
        fromAgentId: agent.id,
        toAgentId: agent.parentAgentId,
        taskId,
        type: 'HELP_REQUEST',
        priority: 90,
        content: `Task "${task.title}" failed after ${attempt} attempts: ${result.summary}`
      })
    }
    this.ctx.approvals.request({
      projectId: task.projectId,
      agentId: task.agentId,
      taskId,
      action: `Decide what to do about failed task "${task.title}"`,
      reason: result.summary,
      payload: { attempts: attempt, error: result.error }
    })
  }

  /**
   * When the board empties, the project itself goes to the Judge. Tasks passing
   * individually is not the same as the mission being accomplished.
   */
  private async checkProjectCompletion(projectId: string): Promise<void> {
    const project = this.ctx.projects.find(projectId)
    if (!project) return
    if (['COMPLETED', 'ARCHIVED', 'REVIEW'].includes(project.status)) return
    if (this.projectReviews.has(projectId)) return
    if (!this.ctx.projects.hasSettled(projectId)) return
    if (this.running.size > 0) return

    this.projectReviews.add(projectId)
    try {
      await this.ctx.judge.evaluateProject(projectId, { apply: true })
    } catch (err) {
      this.ctx.bus.emit({
        type: 'SYSTEM',
        projectId,
        level: 'error',
        message: `Project review failed: ${(err as Error).message}`
      })
    } finally {
      this.projectReviews.delete(projectId)
    }
  }

  /** Statuses the UI treats as "in flight". */
  static readonly ACTIVE_STATUSES: TaskStatus[] = ['QUEUED', 'RUNNING', 'REVIEW']
}
