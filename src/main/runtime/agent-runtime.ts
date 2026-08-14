import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { executions as executionsTable } from '../db/schema'
import { emptyUsage, type UsageTotals } from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'
import { buildWorkerPrompt } from './prompts'
import type { ProviderToolSpec } from './provider-types'
import type { ExecutionOutcomeSignal, ToolInvocation } from './tools/types'

export interface RunExecutionInput {
  taskId: string
  agentId: string
  parentExecutionId?: string | null
  depth?: number
  attempt?: number
  signal: AbortSignal
  /** Overrides the prompt entirely; used by the Judge. */
  promptOverride?: string
  systemPromptOverride?: string
  /** Judge runs must not recurse into judging. */
  suppressJudgeTools?: boolean
  /**
   * Judge and watchdog runs execute against a task without owning it, so they
   * must not move it through the normal RUNNING lifecycle.
   */
  manageTaskStatus?: boolean
}

export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'failed' | 'blocked' | 'cancelled'
  summary: string
  text: string
  usage: UsageTotals
  outcome: ExecutionOutcomeSignal | null
  spawnedAgents: string[]
  stopReason: string
  error?: string
}

interface TranscriptEntry {
  at: number
  kind: 'text' | 'tool' | 'note'
  content: string
  data?: Record<string, unknown>
}

/**
 * Runs one agent, once, against one task.
 *
 * This is the layer that turns persistent rows - an agent, a task, its memory
 * and its messages - into a live provider call, and turns the result back into
 * rows. Everything above it (queueing, judging, retrying) is policy; this is
 * mechanism.
 */
export class AgentRuntime {
  constructor(private readonly ctx: AppContext) {}

  async run(input: RunExecutionInput): Promise<ExecutionResult> {
    const task = this.ctx.tasks.get(input.taskId)
    const agent = this.ctx.agents.get(input.agentId)
    const project = this.ctx.projects.get(task.projectId)
    const limits = project.settings.limits
    const depth = input.depth ?? agent.depth

    const budget = this.ctx.budgets.check({
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id
    })
    if (!budget.ok) {
      this.ctx.budgets.reportExceeded({
        projectId: project.id,
        agentId: agent.id,
        taskId: task.id,
        check: budget
      })
      return {
        executionId: '',
        status: 'blocked',
        summary: budget.reason ?? 'Budget exceeded',
        text: '',
        usage: emptyUsage(),
        outcome: { kind: 'blocked', summary: budget.reason ?? 'Budget exceeded' },
        spawnedAgents: [],
        stopReason: 'budget'
      }
    }

    const executionId = id('exe')
    const provider = this.ctx.providers.get(agent.provider)
    const model = this.ctx.providers.resolveModel(agent.model, {
      priority: task.priority,
      isJudge: agent.role === 'judge'
    })

    this.ctx.db
      .insert(executionsTable)
      .values({
        id: executionId,
        projectId: project.id,
        taskId: task.id,
        agentId: agent.id,
        parentExecutionId: input.parentExecutionId ?? null,
        depth,
        status: 'RUNNING',
        provider: agent.provider,
        model,
        attempt: input.attempt ?? task.attempt,
        startedAt: now(),
        heartbeatAt: now()
      })
      .run()

    this.ctx.agents.setStatus(agent.id, 'RUNNING')
    if (input.manageTaskStatus !== false && task.status !== 'RUNNING') {
      this.ctx.tasks.setStatus(task.id, 'RUNNING')
    }

    this.ctx.bus.emit({
      type: 'EXECUTION_STARTED',
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      executionId,
      message: `${agent.name} started "${task.title}" (${provider.label}, ${model})`,
      data: { depth, attempt: input.attempt ?? task.attempt, provider: provider.id, model }
    })

    const workspaceDir = await this.ensureWorkspace(project.id, project.rootPath, agent.id)
    const transcript: TranscriptEntry[] = []
    let outcome: ExecutionOutcomeSignal | null = null
    const spawnedAgents: string[] = []

    const invocation: ToolInvocation = {
      ctx: this.ctx,
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      executionId,
      depth,
      signal: input.signal,
      workspaceDir,
      spawnedAgents,
      finish: (signal) => {
        outcome = signal
      }
    }

    // Tool activity is recorded from the bus so both provider styles - ones
    // that call back into us and ones that drive their own loop through the
    // MCP bridge - produce the same transcript.
    const offTool = this.ctx.bus.on('*', (event) => {
      if (event.executionId !== executionId) return
      if (event.type !== 'TOOL_COMPLETED' && event.type !== 'TOOL_FAILED') return
      transcript.push({
        at: event.createdAt,
        kind: 'tool',
        content: `${String(event.data.tool)} → ${event.type === 'TOOL_COMPLETED' ? 'ok' : 'failed'}`,
        data: event.data
      })
      this.touch(executionId)
    })

    const tools = this.buildToolSpecs(agent.id, input.suppressJudgeTools === true)
    this.ctx.control.register({
      invocation,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }))
    })

    const prompt = input.promptOverride ?? this.buildPrompt(task.id, agent.id, depth, limits)
    const systemPrompt =
      input.systemPromptOverride ??
      [agent.systemPrompt, project.instructions ? `\nProject instructions:\n${project.instructions}` : '']
        .join('')
        .trim()

    let usage: UsageTotals = emptyUsage()
    let text = ''
    let stopReason = 'end'
    let error: string | undefined

    try {
      const result = await provider.run(
        {
          executionId,
          agentName: agent.name,
          systemPrompt,
          prompt,
          model,
          temperature: agent.temperature / 100,
          tools,
          permissions: agent.permissions,
          maxIterations: limits.maxIterationsPerExecution,
          maxRuntimeMs: limits.maxRuntimeMsPerExecution,
          workspaceDir,
          signal: input.signal
        },
        {
          onText: (chunk) => {
            transcript.push({ at: now(), kind: 'text', content: chunk })
            this.touch(executionId)
            this.ctx.bus.emit({
              type: 'EXECUTION_OUTPUT',
              projectId: project.id,
              agentId: agent.id,
              taskId: task.id,
              executionId,
              level: 'debug',
              message: chunk.slice(0, 2000),
              persist: false
            })
          },
          onToolCall: async (name, toolInput) => {
            if (this.overToolLimit(executionId, limits.maxToolCallsPerExecution)) {
              return {
                ok: false,
                content: `Tool call limit of ${limits.maxToolCallsPerExecution} reached for this execution. Finish or report blocked.`
              }
            }
            return this.ctx.toolRuntime.call({ name, input: toolInput, invocation })
          },
          onUsage: (delta) => {
            usage.inputTokens += delta.inputTokens ?? 0
            usage.outputTokens += delta.outputTokens ?? 0
            usage.costUsd += delta.costUsd ?? 0
            this.persistUsage(executionId, usage)
          },
          onIteration: (iteration) => {
            this.ctx.db
              .update(executionsTable)
              .set({ iterations: iteration, heartbeatAt: now() })
              .where(eq(executionsTable.id, executionId))
              .run()
          }
        }
      )
      usage = { ...result.usage, toolCalls: usage.toolCalls }
      text = result.text
      stopReason = result.stopReason
      error = result.error
    } catch (err) {
      stopReason = 'error'
      error = (err as Error).message
    } finally {
      offTool()
      this.ctx.control.unregister(executionId)
    }

    const resolved = this.resolveOutcome({
      outcome,
      stopReason,
      error,
      text,
      aborted: input.signal.aborted
    })

    const row = this.ctx.db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.id, executionId))
      .get()

    this.ctx.db
      .update(executionsTable)
      .set({
        status:
          resolved.status === 'completed'
            ? 'COMPLETED'
            : resolved.status === 'cancelled'
              ? 'CANCELLED'
              : 'FAILED',
        summary: resolved.summary.slice(0, 4000),
        error: resolved.error ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: Math.round(usage.costUsd * 1_000_000),
        toolCallCount: row?.toolCallCount ?? 0,
        transcript: transcript.slice(-400),
        endedAt: now(),
        heartbeatAt: now()
      })
      .where(eq(executionsTable.id, executionId))
      .run()

    this.ctx.agents.setStatus(
      agent.id,
      resolved.status === 'failed' ? 'FAILED' : 'IDLE',
      resolved.status === 'failed' ? `"${agent.name}" failed: ${resolved.summary}` : undefined
    )

    this.ctx.bus.emit({
      type: resolved.status === 'completed' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      executionId,
      level: resolved.status === 'completed' ? 'info' : 'warn',
      message: `${agent.name} ${resolved.status} "${task.title}" in ${Math.round(usage.durationMs / 1000)}s`,
      data: {
        status: resolved.status,
        stopReason,
        costUsd: usage.costUsd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        spawnedAgents: spawnedAgents.length
      }
    })

    return {
      executionId,
      status: resolved.status,
      summary: resolved.summary,
      text,
      usage,
      outcome,
      spawnedAgents,
      stopReason,
      error: resolved.error
    }
  }

  /**
   * How an execution ended. An agent that calls `complete_task` states its
   * intent; one that simply stops talking is treated as finished but flagged,
   * because failing it outright would trap honest work in a retry loop.
   */
  private resolveOutcome(input: {
    outcome: ExecutionOutcomeSignal | null
    stopReason: string
    error?: string
    text: string
    aborted: boolean
  }): { status: ExecutionResult['status']; summary: string; error?: string } {
    if (input.aborted || input.stopReason === 'aborted') {
      return { status: 'cancelled', summary: 'Execution was cancelled.' }
    }
    if (input.outcome?.kind === 'blocked') {
      return { status: 'blocked', summary: input.outcome.summary }
    }
    if (input.outcome?.kind === 'failed') {
      return { status: 'failed', summary: input.outcome.summary, error: input.outcome.summary }
    }
    if (input.outcome?.kind === 'completed') {
      return { status: 'completed', summary: input.outcome.summary }
    }
    if (input.stopReason === 'error') {
      return {
        status: 'failed',
        summary: input.error ?? 'The provider reported an error.',
        error: input.error
      }
    }
    if (input.stopReason === 'max_iterations') {
      return {
        status: 'failed',
        summary: 'Hit the iteration limit without finishing.',
        error: 'max_iterations'
      }
    }
    if (input.text.trim()) {
      return {
        status: 'completed',
        summary: `${input.text.trim().slice(0, 1500)}\n\n[Ended without calling complete_task.]`
      }
    }
    return {
      status: 'failed',
      summary: 'The agent produced no output and never reported a result.',
      error: 'empty_output'
    }
  }

  private buildPrompt(
    taskId: string,
    agentId: string,
    depth: number,
    limits: { maxDepth: number; maxChildrenPerAgent: number; maxTotalAgents: number }
  ): string {
    const task = this.ctx.tasks.get(taskId)
    const agent = this.ctx.agents.get(agentId)
    const project = this.ctx.projects.get(task.projectId)

    const memories = this.ctx.memory
      .query({
        projectId: project.id,
        agentId,
        query: `${task.title} ${task.description}`,
        limit: 10
      })
      .map((m) => `${m.kind}: ${m.content}`)

    const inbox = this.ctx.messages.inbox(agentId, true)
    this.ctx.messages.markRead(inbox.map((m) => m.id))
    const messages = inbox.map((m) => {
      const from = m.fromAgentId ? (this.ctx.agents.find(m.fromAgentId)?.name ?? '?') : 'System'
      return `[${m.type}] ${from}: ${m.content}`
    })

    let priorFeedback: {
      attempt: number
      score: number
      issues: string[]
      requiredChanges: string[]
    } | null = null
    const sourceTaskId = task.revisionOfTaskId ?? task.id
    const evaluation = this.ctx.evaluations.latestForTask(sourceTaskId)
    if (evaluation && evaluation.decision !== 'APPROVED') {
      priorFeedback = {
        attempt: task.revisionCount,
        score: evaluation.score / 100,
        issues: evaluation.issues,
        requiredChanges: evaluation.requiredChanges
      }
    }

    return buildWorkerPrompt({
      projectName: project.name,
      projectMission: project.mission,
      projectInstructions: project.instructions,
      agentName: agent.name,
      agentDescription: agent.description,
      taskTitle: task.title,
      taskDescription: task.description,
      acceptanceCriteria: task.acceptanceCriteria.map((c) => ({ id: c.id, text: c.text })),
      memories,
      messages,
      priorFeedback,
      depth,
      limits: {
        maxDepth: limits.maxDepth,
        maxChildren: agent.maxChildren ?? limits.maxChildrenPerAgent,
        remainingAgentBudget: Math.max(
          0,
          limits.maxTotalAgents - this.ctx.agents.countInProject(project.id)
        )
      }
    })
  }

  private buildToolSpecs(agentId: string, suppressJudge: boolean): ProviderToolSpec[] {
    return this.ctx.tools
      .toolsForAgent(agentId)
      .filter((tool) => !(suppressJudge && tool.name === 'request_judgement'))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        requiredPermissions: tool.requiredPermissions
      }))
  }

  /**
   * Where this execution may touch files.
   *
   * With workspace isolation on and the project under git, each agent gets its
   * own worktree so concurrent agents cannot overwrite one another.
   */
  private async ensureWorkspace(
    projectId: string,
    rootPath: string | null,
    agentId: string
  ): Promise<string> {
    const shared = rootPath ?? path.join(this.ctx.paths.workspaces, projectId)
    await fs.mkdir(shared, { recursive: true })
    try {
      return await this.ctx.git.ensureAgentWorkspace(agentId, shared)
    } catch {
      return shared
    }
  }

  private touch(executionId: string): void {
    this.ctx.db
      .update(executionsTable)
      .set({ heartbeatAt: now() })
      .where(eq(executionsTable.id, executionId))
      .run()
  }

  private persistUsage(executionId: string, usage: UsageTotals): void {
    this.ctx.db
      .update(executionsTable)
      .set({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: Math.round(usage.costUsd * 1_000_000),
        heartbeatAt: now()
      })
      .where(eq(executionsTable.id, executionId))
      .run()
  }

  private overToolLimit(executionId: string, limit: number): boolean {
    const row = this.ctx.db
      .select({ n: executionsTable.toolCallCount })
      .from(executionsTable)
      .where(eq(executionsTable.id, executionId))
      .get()
    return (row?.n ?? 0) >= limit
  }
}
