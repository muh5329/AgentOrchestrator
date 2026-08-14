import { arr, fail, obj, ok, str, type ToolDefinition } from './types'

const TOOLKIT = 'Core'

/**
 * Tools every agent gets, regardless of toolkit assignment. These are how an
 * execution ends deliberately rather than by running out of turns.
 */
export const lifecycleTools: ToolDefinition[] = [
  {
    name: 'complete_task',
    toolkit: TOOLKIT,
    description:
      'Declare the task finished and hand it to the Judge. Summarise what you actually did ' +
      'and point at the evidence. Saying "done" does not make it done - the Judge verifies.',
    requiredPermissions: [],
    inputSchema: obj(
      {
        summary: str('What you did, and how a reviewer can verify it.'),
        artifacts: arr('Paths or titles of things you produced.', { type: 'string' }),
        criteria_met: arr('Ids of acceptance criteria you believe are satisfied.', {
          type: 'string'
        })
      },
      ['summary']
    ),
    async handler(input, inv) {
      for (const title of (input.artifacts as string[]) ?? []) {
        inv.ctx.artifacts.create({
          projectId: inv.projectId,
          taskId: inv.taskId,
          executionId: inv.executionId,
          agentId: inv.agentId,
          kind: 'claimed',
          title: String(title),
          path: String(title).includes('/') ? String(title) : null
        })
      }
      inv.finish({
        kind: 'completed',
        summary: String(input.summary),
        data: { criteriaMet: (input.criteria_met as string[]) ?? [] }
      })
      return ok('Task submitted for review.')
    }
  },

  {
    name: 'report_blocked',
    toolkit: TOOLKIT,
    description:
      'Stop and report that you cannot proceed. Use this instead of guessing or producing ' +
      'plausible-looking work you cannot stand behind.',
    requiredPermissions: [],
    inputSchema: obj(
      {
        reason: str('What is blocking you.'),
        needs: str('What would unblock you: a decision, a permission, another agent.')
      },
      ['reason']
    ),
    async handler(input, inv) {
      inv.finish({
        kind: 'blocked',
        summary: String(input.reason),
        data: { needs: input.needs ? String(input.needs) : null }
      })
      return ok('Blocker reported.')
    }
  },

  {
    name: 'request_approval',
    toolkit: TOOLKIT,
    description:
      'Ask a human to approve an action before you take it. Blocks until they answer. ' +
      'Use for anything irreversible, expensive, or outside the project workspace.',
    requiredPermissions: [],
    timeoutMs: 60 * 60_000,
    inputSchema: obj(
      { action: str('What you want to do.'), reason: str('Why it needs doing.') },
      ['action', 'reason']
    ),
    async handler(input, inv) {
      const approval = inv.ctx.approvals.request({
        projectId: inv.projectId,
        agentId: inv.agentId,
        taskId: inv.taskId,
        executionId: inv.executionId,
        action: String(input.action),
        reason: String(input.reason)
      })
      const outcome = await inv.ctx.approvals.wait(approval.id, 60 * 60_000, inv.signal)
      if (outcome.status === 'APPROVED') {
        return ok(`Approved${outcome.resolution ? `: ${outcome.resolution}` : ''}. Proceed.`)
      }
      return fail(
        `Not approved (${outcome.status})${outcome.resolution ? `: ${outcome.resolution}` : ''}. ` +
          `Do not take this action. Report blocked if you cannot continue without it.`
      )
    }
  },

  {
    name: 'request_judgement',
    toolkit: TOOLKIT,
    description:
      'Ask the Judge to evaluate a task now and return its verdict. Use it to check your own ' +
      'work before submitting, or to review a subordinate\'s completed task.',
    requiredPermissions: ['JUDGE_INVOKE'],
    timeoutMs: 20 * 60_000,
    inputSchema: obj({ task_id: str('Task to evaluate. Defaults to your current task.') }),
    async handler(input, inv) {
      const taskId = input.task_id ? String(input.task_id) : inv.taskId
      if (!taskId) return fail('No task to judge.')
      const verdict = await inv.ctx.judge.evaluate(taskId, { signal: inv.signal, apply: false })
      return ok(
        `Score ${(verdict.score * 100).toFixed(0)}% - ${verdict.decision}\n${verdict.summary}` +
          (verdict.requiredChanges.length
            ? `\nRequired changes:\n${verdict.requiredChanges.map((c) => `- ${c}`).join('\n')}`
            : ''),
        verdict
      )
    }
  },

  {
    name: 'create_tool',
    toolkit: TOOLKIT,
    description:
      'Define a new reusable tool for this project - a shell command, an HTTP call, or a ' +
      'JavaScript function - and add it to a toolkit so agents can use it.',
    requiredPermissions: ['TOOL_CREATE'],
    inputSchema: obj(
      {
        name: str('snake_case tool name.'),
        description: str('What it does and when to use it.'),
        kind: str('One of: shell, http, javascript.'),
        toolkit: str('Toolkit name to add it to. Created if it does not exist.'),
        implementation: str(
          'Shell command template, URL, or JavaScript body. Use {{param}} placeholders.'
        ),
        parameters: arr('Parameter names the tool accepts.', { type: 'string' })
      },
      ['name', 'description', 'kind', 'implementation']
    ),
    async handler(input, inv) {
      try {
        const tool = inv.ctx.tools.createCustomTool({
          projectId: inv.projectId,
          toolkitName: input.toolkit ? String(input.toolkit) : 'Project tools',
          name: String(input.name),
          description: String(input.description),
          kind: String(input.kind) as 'shell' | 'http' | 'javascript',
          implementation: String(input.implementation),
          parameters: ((input.parameters as string[]) ?? []).map(String),
          createdByAgentId: inv.agentId
        })
        return ok(`Tool "${tool.name}" created in toolkit.`, { toolId: tool.id })
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    }
  }
]
