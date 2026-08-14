import { arr, num, obj, ok, str, type ToolDefinition } from './types'
import type { MemoryKind } from '../../../shared/domain'

const TOOLKIT = 'Knowledge'

export const knowledgeTools: ToolDefinition[] = [
  {
    name: 'remember',
    toolkit: TOOLKIT,
    description:
      'Record something durable: a decision, a constraint, a fact another agent will need. ' +
      'Memory outlives your execution and is retrieved into future prompts, so write the ' +
      'conclusion rather than the narrative.',
    requiredPermissions: ['MEMORY_WRITE'],
    inputSchema: obj(
      {
        content: str('The thing worth remembering, in one or two sentences.'),
        kind: str('One of: fact, decision, constraint, preference, summary, lesson.'),
        key: str('Optional stable key so later writes replace this one.'),
        tags: arr('Tags for retrieval.', { type: 'string' }),
        importance: num('0-100. Default 50.'),
        shared: str('Set to "project" to share with every agent. Default is your own memory.')
      },
      ['content']
    ),
    async handler(input, inv) {
      const shared = String(input.shared ?? '') === 'project'
      const row = inv.ctx.memory.write({
        projectId: inv.projectId,
        agentId: shared ? null : inv.agentId,
        taskId: inv.taskId,
        scope: shared ? 'project' : 'agent',
        kind: (input.kind as MemoryKind) ?? 'fact',
        key: input.key ? String(input.key) : undefined,
        content: String(input.content),
        tags: (input.tags as string[]) ?? [],
        importance: input.importance == null ? 50 : Number(input.importance)
      })
      return ok(`Remembered (${row.kind}).`, { memoryId: row.id })
    }
  },

  {
    name: 'recall',
    toolkit: TOOLKIT,
    description: 'Search project and personal memory for anything relevant to a question.',
    requiredPermissions: [],
    inputSchema: obj({ query: str('What you are looking for.'), limit: num('Max results.') }, [
      'query'
    ]),
    async handler(input, inv) {
      const rows = inv.ctx.memory.query({
        projectId: inv.projectId,
        agentId: inv.agentId,
        query: String(input.query),
        limit: input.limit == null ? 10 : Number(input.limit)
      })
      if (!rows.length) return ok('Nothing relevant in memory.')
      return ok(
        rows.map((r) => `[${r.kind}] ${r.content}`).join('\n'),
        rows.map((r) => ({ id: r.id, kind: r.kind, content: r.content }))
      )
    }
  },

  {
    name: 'send_message',
    toolkit: TOOLKIT,
    description:
      'Send a structured message to another agent. Use it to hand over context, ask a ' +
      'question, or report upward. Messages are delivered into the recipient\'s next prompt.',
    requiredPermissions: ['AGENT_MESSAGE'],
    inputSchema: obj(
      {
        agent: str('Recipient name or id.'),
        content: str('The message.'),
        type: str('One of: MESSAGE, HELP_REQUEST, REPORT, RESULT. Default MESSAGE.'),
        priority: num('0-100. Default 50.')
      },
      ['agent', 'content']
    ),
    async handler(input, inv) {
      const recipient = inv.ctx.agents.resolve(inv.projectId, String(input.agent))
      inv.ctx.messages.send({
        projectId: inv.projectId,
        fromAgentId: inv.agentId,
        toAgentId: recipient.id,
        taskId: inv.taskId,
        type: (input.type as 'MESSAGE') ?? 'MESSAGE',
        priority: input.priority == null ? 50 : Number(input.priority),
        content: String(input.content)
      })
      return ok(`Message sent to ${recipient.name}.`)
    }
  },

  {
    name: 'broadcast',
    toolkit: TOOLKIT,
    description: 'Send a message every agent on the project will see.',
    requiredPermissions: ['AGENT_MESSAGE'],
    inputSchema: obj({ content: str('The announcement.') }, ['content']),
    async handler(input, inv) {
      inv.ctx.messages.broadcast(inv.projectId, inv.agentId, String(input.content))
      return ok('Broadcast sent.')
    }
  },

  {
    name: 'read_messages',
    toolkit: TOOLKIT,
    description: 'Read your unread messages.',
    requiredPermissions: [],
    inputSchema: obj({}),
    async handler(_input, inv) {
      const rows = inv.ctx.messages.inbox(inv.agentId, true)
      if (!rows.length) return ok('No unread messages.')
      inv.ctx.messages.markRead(rows.map((r) => r.id))
      const rendered = rows
        .map((m) => {
          const from = m.fromAgentId ? inv.ctx.agents.find(m.fromAgentId)?.name : 'System'
          return `[${m.type}] from ${from ?? 'unknown'}: ${m.content}`
        })
        .join('\n')
      return ok(rendered, rows)
    }
  },

  {
    name: 'report_to_parent',
    toolkit: TOOLKIT,
    description: 'Report status or a finding to the agent that created you.',
    requiredPermissions: ['AGENT_MESSAGE'],
    inputSchema: obj({ content: str('Your report.') }, ['content']),
    async handler(input, inv) {
      const me = inv.ctx.agents.get(inv.agentId)
      if (!me.parentAgentId) return ok('You have no parent agent; nothing sent.')
      inv.ctx.messages.send({
        projectId: inv.projectId,
        fromAgentId: inv.agentId,
        toAgentId: me.parentAgentId,
        taskId: inv.taskId,
        type: 'REPORT',
        content: String(input.content)
      })
      return ok('Report delivered to parent.')
    }
  },

  {
    name: 'record_artifact',
    toolkit: TOOLKIT,
    description:
      'Register something you produced - a file, a document, a decision record - as an ' +
      'artifact of this task. The Judge reads artifacts as evidence.',
    requiredPermissions: [],
    inputSchema: obj(
      {
        title: str('What it is.'),
        kind: str('e.g. file, document, plan, test-report.'),
        path: str('Path on disk, if it is a file.'),
        content: str('Inline content, if it is short.')
      },
      ['title']
    ),
    async handler(input, inv) {
      const artifact = inv.ctx.artifacts.create({
        projectId: inv.projectId,
        taskId: inv.taskId,
        executionId: inv.executionId,
        agentId: inv.agentId,
        kind: input.kind ? String(input.kind) : 'note',
        title: String(input.title),
        path: input.path ? String(input.path) : null,
        content: input.content ? String(input.content) : null
      })
      return ok(`Artifact recorded: ${artifact.title}.`, { artifactId: artifact.id })
    }
  }
]
