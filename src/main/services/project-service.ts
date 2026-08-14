import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { NotFoundError } from '../core/errors'
import {
  agents as agentsTable,
  evaluations as evaluationsTable,
  executions as executionsTable,
  projects as projectsTable,
  tasks as tasksTable,
  type ProjectRow
} from '../db/schema'
import {
  DEFAULT_PROJECT_SETTINGS,
  type AcceptanceCriterion,
  type ProjectSettings,
  type ProjectStatus
} from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'
import { JUDGE_SYSTEM_PROMPT, ORCHESTRATOR_SYSTEM_PROMPT } from '../runtime/prompts'

/** Callers may override individual safety limits without restating them all. */
export type PartialProjectSettings = Partial<Omit<ProjectSettings, 'limits'>> & {
  limits?: Partial<ProjectSettings['limits']>
}

export interface CreateProjectInput {
  name: string
  description?: string
  mission?: string
  instructions?: string
  rootPath?: string | null
  template?: string | null
  settings?: PartialProjectSettings
  acceptanceCriteria?: AcceptanceCriterion[]
  /** Set false when a test or importer wants a bare project. */
  bootstrapBuiltInAgents?: boolean
  createdByAgentId?: string | null
}

export interface ProjectStats {
  agents: number
  agentsRunning: number
  agentsIdle: number
  agentsFailed: number
  tasksTotal: number
  tasksByStatus: Record<string, number>
  pendingReviews: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  executions: number
  averageScore: number | null
  requirementCoverage: number | null
  progress: number
}

export class ProjectService {
  constructor(private readonly ctx: AppContext) {}

  create(input: CreateProjectInput): ProjectRow {
    const settings: ProjectSettings = {
      ...DEFAULT_PROJECT_SETTINGS,
      ...input.settings,
      limits: { ...DEFAULT_PROJECT_SETTINGS.limits, ...(input.settings?.limits ?? {}) }
    }
    const projectId = id('prj')
    const ts = now()

    this.ctx.db
      .insert(projectsTable)
      .values({
        id: projectId,
        name: input.name,
        description: input.description ?? '',
        mission: input.mission ?? '',
        instructions: input.instructions ?? '',
        rootPath: input.rootPath ?? null,
        template: input.template ?? null,
        status: 'DRAFT',
        settings,
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        createdAt: ts,
        updatedAt: ts
      })
      .run()

    if (input.bootstrapBuiltInAgents !== false) {
      this.bootstrapBuiltInAgents(projectId, settings)
    }

    this.ctx.bus.emit({
      type: 'PROJECT_CREATED',
      projectId,
      message: `Project "${input.name}" created`,
      data: { name: input.name, mission: input.mission ?? '' }
    })

    return this.get(projectId)
  }

  /**
   * Every project gets an Orchestrator and a Judge. They are ordinary agent
   * rows built on the same primitive as user-defined agents - the only thing
   * that marks them is `isBuiltIn` and their role.
   */
  private bootstrapBuiltInAgents(projectId: string, settings: ProjectSettings): void {
    this.ctx.agents.create({
      projectId,
      name: 'Orchestrator',
      role: 'orchestrator',
      description: 'Analyses the mission, designs the agent fleet, assigns and supervises work.',
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      provider: settings.defaultProvider,
      model: settings.defaultModel,
      isBuiltIn: true,
      permissions: [
        'FILES_READ',
        'AGENT_CREATE',
        'AGENT_INVOKE',
        'AGENT_MESSAGE',
        'TASK_CREATE',
        'TASK_UPDATE',
        'SCHEDULE_CREATE',
        'MEMORY_WRITE',
        'JUDGE_INVOKE'
      ],
      toolkitNames: ['Orchestration', 'Knowledge']
    })

    this.ctx.agents.create({
      projectId,
      name: 'Judge',
      role: 'judge',
      description: 'Independently evaluates completed work against acceptance criteria.',
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      provider: settings.defaultProvider,
      model: settings.judgeModel ?? settings.defaultModel,
      isBuiltIn: true,
      permissions: ['FILES_READ', 'AGENT_MESSAGE', 'MEMORY_WRITE'],
      toolkitNames: ['Knowledge', 'Inspection']
    })
  }

  get(projectId: string): ProjectRow {
    const row = this.ctx.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .get()
    if (!row) throw new NotFoundError('Project', projectId)
    return row
  }

  find(projectId: string): ProjectRow | undefined {
    return this.ctx.db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).get()
  }

  list(includeArchived = false): ProjectRow[] {
    const q = this.ctx.db.select().from(projectsTable)
    const rows = includeArchived
      ? q.orderBy(desc(projectsTable.createdAt)).all()
      : q.where(isNull(projectsTable.archivedAt)).orderBy(desc(projectsTable.createdAt)).all()
    return rows
  }

  update(
    projectId: string,
    patch: Partial<
      Pick<
        ProjectRow,
        | 'name'
        | 'description'
        | 'mission'
        | 'instructions'
        | 'status'
        | 'rootPath'
        | 'settings'
        | 'acceptanceCriteria'
      >
    >
  ): ProjectRow {
    this.get(projectId)
    this.ctx.db
      .update(projectsTable)
      .set({ ...patch, updatedAt: now() })
      .where(eq(projectsTable.id, projectId))
      .run()
    const row = this.get(projectId)
    this.ctx.bus.emit({
      type: 'PROJECT_UPDATED',
      projectId,
      message: `Project "${row.name}" updated`,
      data: { patch: Object.keys(patch) }
    })
    return row
  }

  setStatus(projectId: string, status: ProjectStatus): ProjectRow {
    const row = this.update(projectId, { status })
    if (status === 'COMPLETED') {
      this.ctx.bus.emit({
        type: 'PROJECT_COMPLETED',
        projectId,
        message: `Project "${row.name}" complete`,
        data: this.stats(projectId) as unknown as Record<string, unknown>
      })
    }
    return row
  }

  archive(projectId: string): void {
    this.ctx.db
      .update(projectsTable)
      .set({ archivedAt: now(), status: 'ARCHIVED', updatedAt: now() })
      .where(eq(projectsTable.id, projectId))
      .run()
    this.ctx.bus.emit({ type: 'PROJECT_UPDATED', projectId, message: 'Project archived' })
  }

  delete(projectId: string): void {
    const row = this.get(projectId)
    this.ctx.db.delete(projectsTable).where(eq(projectsTable.id, projectId)).run()
    this.ctx.bus.emit({
      type: 'PROJECT_DELETED',
      message: `Project "${row.name}" deleted`,
      data: { projectId }
    })
  }

  settings(projectId: string): ProjectSettings {
    return this.get(projectId).settings
  }

  stats(projectId: string): ProjectStats {
    const db = this.ctx.db

    const agentRows = db
      .select({ status: agentsTable.status, n: count() })
      .from(agentsTable)
      .where(eq(agentsTable.projectId, projectId))
      .groupBy(agentsTable.status)
      .all()

    const taskRows = db
      .select({ status: tasksTable.status, n: count() })
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId))
      .groupBy(tasksTable.status)
      .all()

    const tasksByStatus: Record<string, number> = {}
    for (const r of taskRows) tasksByStatus[r.status] = r.n
    const tasksTotal = taskRows.reduce((a, r) => a + r.n, 0)

    const usage = db
      .select({
        cost: sql<number>`coalesce(sum(${executionsTable.costUsd}), 0)`,
        input: sql<number>`coalesce(sum(${executionsTable.inputTokens}), 0)`,
        output: sql<number>`coalesce(sum(${executionsTable.outputTokens}), 0)`,
        n: count()
      })
      .from(executionsTable)
      .where(eq(executionsTable.projectId, projectId))
      .get()

    const scoreRow = db
      .select({ avg: sql<number | null>`avg(${evaluationsTable.score})` })
      .from(evaluationsTable)
      .where(eq(evaluationsTable.projectId, projectId))
      .get()

    const project = this.get(projectId)
    const criteria = project.acceptanceCriteria ?? []
    const met = criteria.filter((c) => c.met === true).length
    const coverage = criteria.length ? met / criteria.length : null

    const byStatus = (s: string): number => agentRows.find((r) => r.status === s)?.n ?? 0
    const completed = tasksByStatus.COMPLETED ?? 0
    const cancelled = tasksByStatus.CANCELLED ?? 0
    const denominator = tasksTotal - cancelled

    return {
      agents: agentRows.reduce((a, r) => a + r.n, 0),
      agentsRunning: byStatus('RUNNING'),
      agentsIdle: byStatus('IDLE') + byStatus('CREATED'),
      agentsFailed: byStatus('FAILED'),
      tasksTotal,
      tasksByStatus,
      pendingReviews: tasksByStatus.REVIEW ?? 0,
      costUsd: (usage?.cost ?? 0) / 1_000_000,
      inputTokens: usage?.input ?? 0,
      outputTokens: usage?.output ?? 0,
      executions: usage?.n ?? 0,
      averageScore: scoreRow?.avg == null ? null : Number(scoreRow.avg) / 100,
      requirementCoverage: coverage,
      progress: denominator > 0 ? completed / denominator : 0
    }
  }

  /** True when every non-cancelled task is complete and criteria are met. */
  isComplete(projectId: string): boolean {
    const open = this.ctx.db
      .select({ n: count() })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.projectId, projectId),
          sql`${tasksTable.status} not in ('COMPLETED','CANCELLED')`
        )
      )
      .get()
    if ((open?.n ?? 0) > 0) return false

    const done = this.ctx.db
      .select({ n: count() })
      .from(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), eq(tasksTable.status, 'COMPLETED')))
      .get()
    if ((done?.n ?? 0) === 0) return false

    // Criteria only count as satisfied when something verified them. Silence is
    // not success.
    const criteria = this.get(projectId).acceptanceCriteria ?? []
    return criteria.every((c) => c.met === true)
  }

  /** True when no task is left to run, whatever the criteria say. */
  hasSettled(projectId: string): boolean {
    const open = this.ctx.db
      .select({ n: count() })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.projectId, projectId),
          sql`${tasksTable.status} not in ('COMPLETED','CANCELLED','FAILED')`
        )
      )
      .get()
    if ((open?.n ?? 0) > 0) return false
    const done = this.ctx.db
      .select({ n: count() })
      .from(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), eq(tasksTable.status, 'COMPLETED')))
      .get()
    return (done?.n ?? 0) > 0
  }

  setCriteria(projectId: string, criteria: AcceptanceCriterion[]): void {
    this.ctx.db
      .update(projectsTable)
      .set({ acceptanceCriteria: criteria, updatedAt: now() })
      .where(eq(projectsTable.id, projectId))
      .run()
  }
}
