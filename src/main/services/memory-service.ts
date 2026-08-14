import { and, desc, eq, inArray, or, isNull } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { memories as memoriesTable, type MemoryRow } from '../db/schema'
import type { MemoryKind, MemoryScope } from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'

export interface WriteMemoryInput {
  projectId: string
  agentId?: string | null
  taskId?: string | null
  scope?: MemoryScope
  kind?: MemoryKind
  key?: string
  content: string
  tags?: string[]
  importance?: number
}

export interface MemoryQuery {
  projectId: string
  agentId?: string | null
  query?: string
  kinds?: MemoryKind[]
  limit?: number
}

/**
 * Persistent knowledge for a project and its agents.
 *
 * Retrieval is deliberately cheap and explainable rather than embedding-based:
 * agents get a small, ranked slice of memory in their prompt instead of the
 * entire project history.
 */
export class MemoryService {
  constructor(private readonly ctx: AppContext) {}

  write(input: WriteMemoryInput): MemoryRow {
    const key = input.key ?? ''
    // Upserting on (project, agent, key) keeps repeated writes from piling up.
    if (key) {
      const existing = this.ctx.db
        .select()
        .from(memoriesTable)
        .where(
          and(
            eq(memoriesTable.projectId, input.projectId),
            eq(memoriesTable.key, key),
            input.agentId
              ? eq(memoriesTable.agentId, input.agentId)
              : isNull(memoriesTable.agentId)
          )
        )
        .get()
      if (existing) {
        this.ctx.db
          .update(memoriesTable)
          .set({
            content: input.content,
            tags: input.tags ?? existing.tags,
            importance: input.importance ?? existing.importance,
            updatedAt: now()
          })
          .where(eq(memoriesTable.id, existing.id))
          .run()
        return this.get(existing.id)
      }
    }

    const memoryId = id('mem')
    this.ctx.db
      .insert(memoriesTable)
      .values({
        id: memoryId,
        projectId: input.projectId,
        agentId: input.agentId ?? null,
        taskId: input.taskId ?? null,
        scope: input.scope ?? (input.agentId ? 'agent' : 'project'),
        kind: input.kind ?? 'fact',
        key,
        content: input.content,
        tags: input.tags ?? [],
        importance: input.importance ?? 50,
        createdAt: now(),
        updatedAt: now()
      })
      .run()

    this.ctx.bus.emit({
      type: 'MEMORY_WRITTEN',
      projectId: input.projectId,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      level: 'debug',
      message: `Remembered: ${truncate(input.content, 80)}`,
      data: { kind: input.kind ?? 'fact', key },
      persist: false
    })

    return this.get(memoryId)
  }

  get(memoryId: string): MemoryRow {
    return this.ctx.db.select().from(memoriesTable).where(eq(memoriesTable.id, memoryId)).get()!
  }

  list(projectId: string): MemoryRow[] {
    return this.ctx.db
      .select()
      .from(memoriesTable)
      .where(eq(memoriesTable.projectId, projectId))
      .orderBy(desc(memoriesTable.importance), desc(memoriesTable.updatedAt))
      .all()
  }

  delete(memoryId: string): void {
    this.ctx.db.delete(memoriesTable).where(eq(memoriesTable.id, memoryId)).run()
  }

  /**
   * Ranked retrieval: project-wide and shared memory plus this agent's own,
   * scored on keyword overlap, importance and recency.
   */
  query(q: MemoryQuery): MemoryRow[] {
    const rows = this.ctx.db
      .select()
      .from(memoriesTable)
      .where(
        and(
          eq(memoriesTable.projectId, q.projectId),
          q.agentId
            ? or(
                isNull(memoriesTable.agentId),
                eq(memoriesTable.agentId, q.agentId),
                inArray(memoriesTable.scope, ['project', 'shared'])
              )
            : undefined,
          q.kinds?.length ? inArray(memoriesTable.kind, q.kinds) : undefined
        )
      )
      .all()

    const terms = tokenize(q.query ?? '')
    const nowTs = now()
    const scored = rows.map((row) => {
      const haystack = tokenize(`${row.key} ${row.content} ${row.tags.join(' ')}`)
      const overlap = terms.length
        ? terms.filter((t) => haystack.includes(t)).length / terms.length
        : 0
      const ageDays = (nowTs - row.updatedAt) / 86_400_000
      const recency = 1 / (1 + ageDays)
      const score = overlap * 3 + (row.importance / 100) * 1.5 + recency
      return { row, score }
    })

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, q.limit ?? 12)
      .map((s) => s.row)
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
