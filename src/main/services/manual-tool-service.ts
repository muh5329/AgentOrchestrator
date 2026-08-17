import { randomUUID } from 'node:crypto'
import type { AppContext } from '../core/context'
import type { ToolResult } from '../runtime/tools/types'

/**
 * Lets a person run one of an agent's tools directly.
 *
 * Deliberately routed through `ToolRuntime` rather than calling the handler, so
 * a hand-run tool is subject to exactly what the agent would be subject to: the
 * agent's permissions, the project's approval policy, the timeout, and the same
 * event trail. Running a tool from the interface is not a back door - if the
 * agent could not call it, neither can you on its behalf.
 *
 * The execution id is synthetic and marked, because no model turn produced this
 * call; that keeps a manual invocation out of an agent's token accounting while
 * still giving the event log something to group by.
 */
export class ManualToolService {
  constructor(private readonly ctx: AppContext) {}

  async invoke(input: {
    agentId: string
    tool: string
    input?: Record<string, unknown>
    taskId?: string | null
  }): Promise<ToolResult & { executionId: string }> {
    const agent = this.ctx.agents.get(input.agentId)
    const executionId = `manual_${randomUUID()}`
    const controller = new AbortController()

    // Manual runs get the shared checkout rather than an agent worktree: the
    // point is usually to inspect or fix what the agent left behind.
    const workspaceDir = await this.ctx.workspace.rootFor(agent.projectId)

    this.ctx.bus.emit({
      type: 'SYSTEM',
      projectId: agent.projectId,
      agentId: agent.id,
      executionId,
      level: 'info',
      message: `You ran "${input.tool}" as ${agent.name}`,
      data: { tool: input.tool, manual: true }
    })

    const result = await this.ctx.toolRuntime.call({
      name: input.tool,
      input: input.input ?? {},
      invocation: {
        ctx: this.ctx,
        projectId: agent.projectId,
        agentId: agent.id,
        taskId: input.taskId ?? null,
        executionId,
        depth: agent.depth,
        signal: controller.signal,
        workspaceDir,
        // A manual call has no execution to end, so the outcome signal is a
        // no-op rather than a lie about a turn that never happened.
        finish: () => undefined,
        spawnedAgents: []
      }
    })

    return { ...result, executionId }
  }
}
