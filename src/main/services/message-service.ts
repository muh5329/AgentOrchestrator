import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { messages as messagesTable, type MessageRow } from '../db/schema'
import type { MessageType } from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'

export interface SendMessageInput {
  projectId: string
  fromAgentId?: string | null
  toAgentId?: string | null
  taskId?: string | null
  type?: MessageType
  priority?: number
  content: string
  data?: Record<string, unknown>
}

/**
 * Structured agent-to-agent communication.
 *
 * Messages are first-class rows rather than text smuggled through prompts, so
 * they can be routed, prioritised, audited and replayed.
 */
export class MessageService {
  constructor(private readonly ctx: AppContext) {}

  send(input: SendMessageInput): MessageRow {
    const messageId = id('msg')
    this.ctx.db
      .insert(messagesTable)
      .values({
        id: messageId,
        projectId: input.projectId,
        fromAgentId: input.fromAgentId ?? null,
        toAgentId: input.toAgentId ?? null,
        taskId: input.taskId ?? null,
        type: input.type ?? 'MESSAGE',
        priority: input.priority ?? 50,
        content: input.content,
        data: input.data ?? {},
        createdAt: now()
      })
      .run()

    const fromName = input.fromAgentId
      ? (this.ctx.agents.find(input.fromAgentId)?.name ?? 'unknown')
      : 'System'
    const toName = input.toAgentId
      ? (this.ctx.agents.find(input.toAgentId)?.name ?? 'unknown')
      : 'everyone'

    this.ctx.bus.emit({
      type: 'AGENT_MESSAGE',
      projectId: input.projectId,
      agentId: input.fromAgentId ?? null,
      taskId: input.taskId ?? null,
      message: `${fromName} → ${toName}: ${input.content.slice(0, 120)}`,
      data: {
        messageId,
        toAgentId: input.toAgentId ?? null,
        type: input.type ?? 'MESSAGE'
      }
    })

    return this.get(messageId)
  }

  broadcast(projectId: string, fromAgentId: string | null, content: string): MessageRow {
    return this.send({ projectId, fromAgentId, toAgentId: null, content, type: 'BROADCAST' })
  }

  get(messageId: string): MessageRow {
    return this.ctx.db.select().from(messagesTable).where(eq(messagesTable.id, messageId)).get()!
  }

  /** Direct messages plus project broadcasts the agent has not seen. */
  inbox(agentId: string, unreadOnly = true): MessageRow[] {
    const agent = this.ctx.agents.get(agentId)
    return this.ctx.db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.projectId, agent.projectId),
          or(eq(messagesTable.toAgentId, agentId), isNull(messagesTable.toAgentId)),
          unreadOnly ? isNull(messagesTable.readAt) : undefined
        )
      )
      .orderBy(desc(messagesTable.priority), desc(messagesTable.createdAt))
      .all()
      .filter((m) => m.fromAgentId !== agentId)
  }

  markRead(messageIds: string[]): void {
    for (const messageId of messageIds) {
      this.ctx.db
        .update(messagesTable)
        .set({ readAt: now() })
        .where(eq(messagesTable.id, messageId))
        .run()
    }
  }

  thread(projectId: string, limit = 200): MessageRow[] {
    return this.ctx.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.projectId, projectId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit)
      .all()
  }
}
