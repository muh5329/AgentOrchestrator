import { desc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { artifacts as artifactsTable, type ArtifactRow } from '../db/schema'
import { id } from '../util/id'
import { now } from '../util/time'

export interface CreateArtifactInput {
  projectId: string
  taskId?: string | null
  executionId?: string | null
  agentId?: string | null
  kind?: string
  title: string
  path?: string | null
  content?: string | null
  meta?: Record<string, unknown>
}

/** Concrete outputs an agent produced, and the evidence the Judge reads. */
export class ArtifactService {
  constructor(private readonly ctx: AppContext) {}

  create(input: CreateArtifactInput): ArtifactRow {
    const artifactId = id('art')
    this.ctx.db
      .insert(artifactsTable)
      .values({
        id: artifactId,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        executionId: input.executionId ?? null,
        agentId: input.agentId ?? null,
        kind: input.kind ?? 'note',
        title: input.title,
        path: input.path ?? null,
        content: input.content ?? null,
        meta: input.meta ?? {},
        createdAt: now()
      })
      .run()
    return this.get(artifactId)
  }

  get(artifactId: string): ArtifactRow {
    return this.ctx.db.select().from(artifactsTable).where(eq(artifactsTable.id, artifactId)).get()!
  }

  listByTask(taskId: string): ArtifactRow[] {
    return this.ctx.db
      .select()
      .from(artifactsTable)
      .where(eq(artifactsTable.taskId, taskId))
      .orderBy(desc(artifactsTable.createdAt))
      .all()
  }

  listByProject(projectId: string, limit = 200): ArtifactRow[] {
    return this.ctx.db
      .select()
      .from(artifactsTable)
      .where(eq(artifactsTable.projectId, projectId))
      .orderBy(desc(artifactsTable.createdAt))
      .limit(limit)
      .all()
  }
}
