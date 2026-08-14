import { and, count, desc, eq, gte, inArray } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { events as eventsTable, executions as executionsTable } from '../db/schema'
import { now } from '../util/time'

export type WatchdogAction = 'none' | 'nudge' | 'escalate' | 'terminate'

export interface WatchdogFinding {
  executionId: string
  taskId: string
  agentId: string
  projectId: string
  symptom: string
  action: WatchdogAction
  detail: string
}

export interface WatchdogOptions {
  intervalMs?: number
  /** How long an execution may go without any event before it looks stuck. */
  silenceMs?: number
  repeatedToolFailureThreshold?: number
}

/**
 * Liveness and sanity checking for running work.
 *
 * An agent that has stopped producing events, is failing the same tool over and
 * over, or is burning budget without progress will not fix itself. The watchdog
 * notices and takes the smallest action that could help, escalating only when
 * it cannot.
 */
export class WatchdogEngine {
  private timer: NodeJS.Timeout | null = null
  private readonly intervalMs: number
  private readonly silenceMs: number
  private readonly repeatedToolFailureThreshold: number
  private readonly nudged = new Set<string>()

  constructor(
    private readonly ctx: AppContext,
    options: WatchdogOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? 15_000
    this.silenceMs = options.silenceMs ?? 3 * 60_000
    this.repeatedToolFailureThreshold = options.repeatedToolFailureThreshold ?? 6
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.sweep(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One pass over everything currently running. Returns what it found. */
  async sweep(at: number = now()): Promise<WatchdogFinding[]> {
    const findings: WatchdogFinding[] = []
    const running = this.ctx.db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.status, 'RUNNING'))
      .all()

    for (const execution of running) {
      const project = this.ctx.projects.find(execution.projectId)
      if (!project) continue
      const limits = project.settings.limits

      const silence = at - execution.heartbeatAt
      const runtime = at - execution.startedAt

      if (runtime > limits.maxRuntimeMsPerExecution) {
        findings.push(
          this.act({
            execution,
            symptom: 'runtime_exceeded',
            action: 'terminate',
            detail: `Running for ${Math.round(runtime / 60_000)} minutes, past the ${Math.round(
              limits.maxRuntimeMsPerExecution / 60_000
            )} minute limit.`
          })
        )
        continue
      }

      if (silence > this.silenceMs) {
        const alreadyNudged = this.nudged.has(execution.id)
        findings.push(
          this.act({
            execution,
            symptom: 'no_progress',
            action: alreadyNudged ? 'terminate' : 'nudge',
            detail: `No activity for ${Math.round(silence / 1000)}s.`
          })
        )
        continue
      }

      const failures = this.recentToolFailures(execution.id)
      if (failures >= this.repeatedToolFailureThreshold) {
        findings.push(
          this.act({
            execution,
            symptom: 'repeated_tool_failures',
            action: 'escalate',
            detail: `${failures} tool failures in this execution.`
          })
        )
        continue
      }

      const budget = this.ctx.budgets.check({
        projectId: execution.projectId,
        agentId: execution.agentId,
        taskId: execution.taskId
      })
      if (!budget.ok) {
        findings.push(
          this.act({
            execution,
            symptom: 'budget_exceeded',
            action: budget.action === 'terminate' ? 'terminate' : 'escalate',
            detail: budget.reason ?? 'Budget exhausted.'
          })
        )
      }
    }

    this.reapOrphans(at)
    return findings
  }

  private recentToolFailures(executionId: string): number {
    return (
      this.ctx.db
        .select({ n: count() })
        .from(eventsTable)
        .where(and(eq(eventsTable.executionId, executionId), eq(eventsTable.type, 'TOOL_FAILED')))
        .get()?.n ?? 0
    )
  }

  private act(input: {
    execution: { id: string; taskId: string; agentId: string; projectId: string }
    symptom: string
    action: WatchdogAction
    detail: string
  }): WatchdogFinding {
    const { execution, symptom, action, detail } = input
    const agent = this.ctx.agents.find(execution.agentId)
    const task = this.ctx.tasks.find(execution.taskId)

    this.ctx.bus.emit({
      type: 'WATCHDOG_ALERT',
      projectId: execution.projectId,
      agentId: execution.agentId,
      taskId: execution.taskId,
      executionId: execution.id,
      level: 'warn',
      message: `Watchdog: ${agent?.name ?? 'agent'} - ${symptom}. ${detail}`,
      data: { symptom, action, detail }
    })

    switch (action) {
      case 'nudge': {
        this.nudged.add(execution.id)
        if (agent?.parentAgentId) {
          this.ctx.messages.send({
            projectId: execution.projectId,
            fromAgentId: null,
            toAgentId: agent.parentAgentId,
            taskId: execution.taskId,
            type: 'HELP_REQUEST',
            priority: 70,
            content: `Watchdog: "${agent.name}" appears stuck on "${task?.title ?? execution.taskId}". ${detail}`
          })
        }
        break
      }
      case 'terminate': {
        this.ctx.executor.cancel(execution.taskId)
        this.ctx.db
          .update(executionsTable)
          .set({ status: 'TIMEOUT', endedAt: now(), error: detail })
          .where(eq(executionsTable.id, execution.id))
          .run()
        if (task && !['COMPLETED', 'CANCELLED'].includes(task.status)) {
          this.ctx.tasks.setStatus(execution.taskId, 'FAILED', { error: `Watchdog: ${detail}` })
        }
        break
      }
      case 'escalate': {
        this.ctx.approvals.request({
          projectId: execution.projectId,
          agentId: execution.agentId,
          taskId: execution.taskId,
          executionId: execution.id,
          action: `Intervene on "${task?.title ?? execution.taskId}"`,
          reason: `${symptom}: ${detail}`
        })
        break
      }
      default:
        break
    }

    this.ctx.bus.emit({
      type: 'WATCHDOG_ACTION',
      projectId: execution.projectId,
      agentId: execution.agentId,
      taskId: execution.taskId,
      executionId: execution.id,
      level: 'warn',
      message: `Watchdog action: ${action}`,
      data: { symptom, action }
    })

    return {
      executionId: execution.id,
      taskId: execution.taskId,
      agentId: execution.agentId,
      projectId: execution.projectId,
      symptom,
      action,
      detail
    }
  }

  /**
   * Execution rows left RUNNING by a crash. Anything older than an hour with no
   * heartbeat is definitively dead, not slow.
   */
  private reapOrphans(at: number): void {
    const stale = this.ctx.db
      .select()
      .from(executionsTable)
      .where(
        and(
          inArray(executionsTable.status, ['RUNNING', 'PENDING']),
          gte(executionsTable.startedAt, 0)
        )
      )
      .all()
      .filter((e) => at - e.heartbeatAt > 60 * 60_000 && !this.ctx.executor.isRunning(e.taskId))

    for (const execution of stale) {
      this.ctx.db
        .update(executionsTable)
        .set({ status: 'FAILED', endedAt: at, error: 'Orphaned by an application restart.' })
        .where(eq(executionsTable.id, execution.id))
        .run()
    }
  }

  /** Most recent watchdog activity, for the UI. */
  recent(projectId: string, limit = 50): Array<Record<string, unknown>> {
    return this.ctx.db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.projectId, projectId),
          inArray(eventsTable.type, ['WATCHDOG_ALERT', 'WATCHDOG_ACTION'])
        )
      )
      .orderBy(desc(eventsTable.createdAt))
      .limit(limit)
      .all() as unknown as Array<Record<string, unknown>>
  }
}
