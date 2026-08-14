import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { evaluations as evaluationsTable, rubrics as rubricsTable, type EvaluationRow, type RubricRow } from '../db/schema'
import { DEFAULT_RUBRIC_DIMENSIONS, type JudgeVerdict, type RubricDimension } from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'

export interface RecordEvaluationInput {
  projectId: string
  taskId: string
  executionId?: string | null
  judgeAgentId?: string | null
  rubricId?: string | null
  attempt?: number
  verdict: JudgeVerdict
}

export class EvaluationService {
  constructor(private readonly ctx: AppContext) {}

  record(input: RecordEvaluationInput): EvaluationRow {
    const evalId = id('evl')
    this.ctx.db
      .insert(evaluationsTable)
      .values({
        id: evalId,
        projectId: input.projectId,
        taskId: input.taskId,
        executionId: input.executionId ?? null,
        judgeAgentId: input.judgeAgentId ?? null,
        rubricId: input.rubricId ?? null,
        score: Math.round(input.verdict.score * 100),
        decision: input.verdict.decision,
        criteria: input.verdict.criteria,
        checklist: input.verdict.criteriaChecklist ?? [],
        issues: input.verdict.issues,
        requiredChanges: input.verdict.requiredChanges,
        summary: input.verdict.summary,
        attempt: input.attempt ?? 0,
        createdAt: now()
      })
      .run()
    return this.get(evalId)
  }

  get(evaluationId: string): EvaluationRow {
    return this.ctx.db
      .select()
      .from(evaluationsTable)
      .where(eq(evaluationsTable.id, evaluationId))
      .get()!
  }

  listByTask(taskId: string): EvaluationRow[] {
    return this.ctx.db
      .select()
      .from(evaluationsTable)
      .where(eq(evaluationsTable.taskId, taskId))
      .orderBy(desc(evaluationsTable.createdAt))
      .all()
  }

  latestForTask(taskId: string): EvaluationRow | undefined {
    return this.listByTask(taskId)[0]
  }

  listByProject(projectId: string, limit = 200): EvaluationRow[] {
    return this.ctx.db
      .select()
      .from(evaluationsTable)
      .where(eq(evaluationsTable.projectId, projectId))
      .orderBy(desc(evaluationsTable.createdAt))
      .limit(limit)
      .all()
  }

  /* ---------------- rubrics ---------------- */

  defaultRubric(projectId: string): RubricRow {
    const existing = this.ctx.db
      .select()
      .from(rubricsTable)
      .where(and(eq(rubricsTable.projectId, projectId), eq(rubricsTable.isDefault, true)))
      .get()
    if (existing) return existing

    const settings = this.ctx.projects.settings(projectId)
    const rubricId = id('rub')
    this.ctx.db
      .insert(rubricsTable)
      .values({
        id: rubricId,
        projectId,
        name: 'Default rubric',
        dimensions: DEFAULT_RUBRIC_DIMENSIONS,
        passThreshold: Math.round(settings.judgePassThreshold * 100),
        escalateThreshold: Math.round(settings.judgeEscalateThreshold * 100),
        isDefault: true,
        createdAt: now()
      })
      .run()
    return this.ctx.db.select().from(rubricsTable).where(eq(rubricsTable.id, rubricId)).get()!
  }

  listRubrics(projectId: string): RubricRow[] {
    return this.ctx.db.select().from(rubricsTable).where(eq(rubricsTable.projectId, projectId)).all()
  }

  saveRubric(input: {
    projectId: string
    name: string
    dimensions: RubricDimension[]
    passThreshold: number
    escalateThreshold: number
    isDefault?: boolean
  }): RubricRow {
    const rubricId = id('rub')
    this.ctx.db
      .insert(rubricsTable)
      .values({
        id: rubricId,
        projectId: input.projectId,
        name: input.name,
        dimensions: input.dimensions,
        passThreshold: Math.round(input.passThreshold * 100),
        escalateThreshold: Math.round(input.escalateThreshold * 100),
        isDefault: input.isDefault ?? false,
        createdAt: now()
      })
      .run()
    return this.ctx.db.select().from(rubricsTable).where(eq(rubricsTable.id, rubricId)).get()!
  }
}
