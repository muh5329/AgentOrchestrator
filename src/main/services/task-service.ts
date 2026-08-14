import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { LimitError, NotFoundError } from '../core/errors'
import {
  taskDependencies,
  tasks as tasksTable,
  type TaskRow
} from '../db/schema'
import {
  DEFAULT_RETRY_POLICY,
  type AcceptanceCriterion,
  type JudgeVerdict,
  type RetryPolicy,
  type TaskStatus
} from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'

export interface CreateTaskInput {
  projectId: string
  title: string
  description?: string
  agentId?: string | null
  parentTaskId?: string | null
  createdByAgentId?: string | null
  priority?: number
  acceptanceCriteria?: Array<string | AcceptanceCriterion>
  context?: Record<string, unknown>
  deadline?: number | null
  retryPolicy?: RetryPolicy | null
  requiresJudge?: boolean
  judgeAgentId?: string | null
  dependsOn?: string[]
  status?: TaskStatus
  scheduleId?: string | null
  revisionOfTaskId?: string | null
  revisionCount?: number
}

export class TaskService {
  constructor(private readonly ctx: AppContext) {}

  create(input: CreateTaskInput): TaskRow {
    const project = this.ctx.projects.get(input.projectId)
    const limits = project.settings.limits

    const existing = this.countInProject(input.projectId)
    if (existing >= limits.maxTasksPerProject) {
      throw new LimitError(
        `Cannot create task: project already has ${existing} tasks (limit ${limits.maxTasksPerProject}).`,
        { limit: 'maxTasksPerProject', existing }
      )
    }

    const taskId = id('tsk')
    const ts = now()
    const criteria = normalizeCriteria(input.acceptanceCriteria ?? [])

    this.ctx.db
      .insert(tasksTable)
      .values({
        id: taskId,
        projectId: input.projectId,
        agentId: input.agentId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        title: input.title,
        description: input.description ?? '',
        status: input.status ?? 'BACKLOG',
        priority: input.priority ?? 50,
        acceptanceCriteria: criteria,
        context: input.context ?? {},
        deadline: input.deadline ?? null,
        retryPolicy: input.retryPolicy ?? DEFAULT_RETRY_POLICY,
        requiresJudge: input.requiresJudge ?? project.settings.autoJudge,
        judgeAgentId: input.judgeAgentId ?? null,
        scheduleId: input.scheduleId ?? null,
        revisionOfTaskId: input.revisionOfTaskId ?? null,
        revisionCount: input.revisionCount ?? 0,
        createdAt: ts,
        updatedAt: ts
      })
      .run()

    for (const dep of input.dependsOn ?? []) {
      this.addDependency(taskId, dep)
    }

    this.ctx.bus.emit({
      type: 'TASK_CREATED',
      projectId: input.projectId,
      agentId: input.agentId ?? null,
      taskId,
      message: `Task "${input.title}" created`,
      data: {
        title: input.title,
        agentId: input.agentId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        criteria: criteria.length
      }
    })

    this.refreshReadiness(taskId)
    return this.get(taskId)
  }

  get(taskId: string): TaskRow {
    const row = this.ctx.db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).get()
    if (!row) throw new NotFoundError('Task', taskId)
    return row
  }

  find(taskId: string): TaskRow | undefined {
    return this.ctx.db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).get()
  }

  list(projectId: string): TaskRow[] {
    return this.ctx.db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId))
      .orderBy(desc(tasksTable.priority), asc(tasksTable.createdAt))
      .all()
  }

  listByAgent(agentId: string): TaskRow[] {
    return this.ctx.db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.agentId, agentId))
      .orderBy(desc(tasksTable.updatedAt))
      .all()
  }

  listByStatus(projectId: string, statuses: TaskStatus[]): TaskRow[] {
    return this.ctx.db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), inArray(tasksTable.status, statuses)))
      .orderBy(desc(tasksTable.priority), asc(tasksTable.createdAt))
      .all()
  }

  countInProject(projectId: string): number {
    return (
      this.ctx.db
        .select({ n: count() })
        .from(tasksTable)
        .where(eq(tasksTable.projectId, projectId))
        .get()?.n ?? 0
    )
  }

  update(taskId: string, patch: Partial<TaskRow>): TaskRow {
    this.get(taskId)
    this.ctx.db
      .update(tasksTable)
      .set({ ...patch, updatedAt: now() })
      .where(eq(tasksTable.id, taskId))
      .run()
    const row = this.get(taskId)
    this.ctx.bus.emit({
      type: 'TASK_UPDATED',
      projectId: row.projectId,
      taskId,
      agentId: row.agentId,
      message: `Task "${row.title}" updated`,
      data: { fields: Object.keys(patch) }
    })
    return row
  }

  assign(taskId: string, agentId: string): TaskRow {
    const agent = this.ctx.agents.get(agentId)
    const task = this.get(taskId)
    this.ctx.db
      .update(tasksTable)
      .set({ agentId, updatedAt: now() })
      .where(eq(tasksTable.id, taskId))
      .run()
    this.ctx.bus.emit({
      type: 'TASK_UPDATED',
      projectId: task.projectId,
      taskId,
      agentId,
      message: `Task "${task.title}" assigned to ${agent.name}`,
      data: { agentId }
    })
    this.refreshReadiness(taskId)
    return this.get(taskId)
  }

  setStatus(taskId: string, status: TaskStatus, extra: Partial<TaskRow> = {}): TaskRow {
    const before = this.get(taskId)
    const patch: Partial<TaskRow> = { status, updatedAt: now(), ...extra }
    if (status === 'RUNNING' && !before.startedAt) patch.startedAt = now()
    if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED') {
      patch.completedAt = now()
    }
    this.ctx.db.update(tasksTable).set(patch).where(eq(tasksTable.id, taskId)).run()
    const row = this.get(taskId)

    const type =
      status === 'RUNNING'
        ? 'TASK_STARTED'
        : status === 'COMPLETED'
          ? 'TASK_COMPLETED'
          : status === 'FAILED'
            ? 'TASK_FAILED'
            : status === 'REVIEW'
              ? 'TASK_REVIEW'
              : status === 'BLOCKED'
                ? 'TASK_BLOCKED'
                : status === 'CANCELLED'
                  ? 'TASK_CANCELLED'
                  : 'TASK_UPDATED'

    this.ctx.bus.emit({
      type,
      projectId: row.projectId,
      taskId,
      agentId: row.agentId,
      level: status === 'FAILED' ? 'error' : status === 'BLOCKED' ? 'warn' : 'info',
      message: `Task "${row.title}" → ${status}`,
      data: { from: before.status, to: status, error: row.error ?? undefined }
    })

    if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED') {
      this.unblockDependents(taskId)
    }
    return row
  }

  addDependency(taskId: string, dependsOnTaskId: string, kind = 'completion'): void {
    if (taskId === dependsOnTaskId) return
    if (this.wouldCycle(taskId, dependsOnTaskId)) {
      throw new LimitError('Refusing to add a dependency that would create a cycle.', {
        taskId,
        dependsOnTaskId
      })
    }
    const exists = this.ctx.db
      .select()
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnTaskId, dependsOnTaskId)
        )
      )
      .get()
    if (exists) return
    this.ctx.db
      .insert(taskDependencies)
      .values({ id: id('dep'), taskId, dependsOnTaskId, kind, createdAt: now() })
      .run()
    this.refreshReadiness(taskId)
  }

  private wouldCycle(taskId: string, dependsOnTaskId: string): boolean {
    // Walk the dependency graph upward from `dependsOnTaskId`; if we reach
    // `taskId`, the new edge closes a loop.
    const stack = [dependsOnTaskId]
    const seen = new Set<string>()
    while (stack.length) {
      const current = stack.pop() as string
      if (current === taskId) return true
      if (seen.has(current)) continue
      seen.add(current)
      const parents = this.ctx.db
        .select({ dep: taskDependencies.dependsOnTaskId })
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, current))
        .all()
      for (const p of parents) stack.push(p.dep)
    }
    return false
  }

  dependencies(taskId: string): string[] {
    return this.ctx.db
      .select({ dep: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, taskId))
      .all()
      .map((r) => r.dep)
  }

  dependents(taskId: string): string[] {
    return this.ctx.db
      .select({ t: taskDependencies.taskId })
      .from(taskDependencies)
      .where(eq(taskDependencies.dependsOnTaskId, taskId))
      .all()
      .map((r) => r.t)
  }

  dependenciesMet(taskId: string): boolean {
    const deps = this.dependencies(taskId)
    if (!deps.length) return true
    const rows = this.ctx.db
      .select({ id: tasksTable.id, status: tasksTable.status })
      .from(tasksTable)
      .where(inArray(tasksTable.id, deps))
      .all()
    return rows.every((r) => r.status === 'COMPLETED')
  }

  /** Moves BACKLOG/BLOCKED tasks to READY once their dependencies clear. */
  refreshReadiness(taskId: string): void {
    const task = this.find(taskId)
    if (!task) return
    if (!['BACKLOG', 'BLOCKED', 'READY'].includes(task.status)) return
    const met = this.dependenciesMet(taskId)
    if (met && task.status !== 'READY') {
      this.setStatus(taskId, 'READY', { blockedReason: null })
    } else if (!met && task.status !== 'BLOCKED') {
      this.setStatus(taskId, 'BLOCKED', { blockedReason: 'Waiting on dependencies' })
    }
  }

  private unblockDependents(taskId: string): void {
    for (const dependentId of this.dependents(taskId)) {
      this.refreshReadiness(dependentId)
    }
  }

  /** Tasks that can be dispatched right now, best first. */
  ready(projectId?: string): TaskRow[] {
    const where = projectId
      ? and(eq(tasksTable.projectId, projectId), inArray(tasksTable.status, ['READY', 'BACKLOG']))
      : inArray(tasksTable.status, ['READY', 'BACKLOG'])
    return this.ctx.db
      .select()
      .from(tasksTable)
      .where(where)
      .orderBy(desc(tasksTable.priority), asc(tasksTable.createdAt))
      .all()
      .filter((t) => t.agentId != null && this.dependenciesMet(t.id))
  }

  cancel(taskId: string, reason = 'Cancelled'): TaskRow {
    return this.setStatus(taskId, 'CANCELLED', { error: reason })
  }

  setScore(taskId: string, score: number): void {
    this.ctx.db
      .update(tasksTable)
      .set({ score: Math.round(score * 100), updatedAt: now() })
      .where(eq(tasksTable.id, taskId))
      .run()
  }

  setCriteria(taskId: string, criteria: AcceptanceCriterion[]): void {
    this.ctx.db
      .update(tasksTable)
      .set({ acceptanceCriteria: criteria, updatedAt: now() })
      .where(eq(tasksTable.id, taskId))
      .run()
  }

  /**
   * Creates the follow-up task the Judge asked for. The revision inherits the
   * original criteria and carries the verdict forward so the agent sees exactly
   * what it must fix.
   */
  createRevision(taskId: string, verdict: JudgeVerdict): TaskRow {
    const original = this.get(taskId)
    const limits = this.ctx.projects.settings(original.projectId).limits
    const revisionCount = original.revisionCount + 1
    if (revisionCount > limits.maxRevisionsPerTask) {
      throw new LimitError(
        `Task "${original.title}" has exhausted its ${limits.maxRevisionsPerTask} revisions.`,
        { limit: 'maxRevisionsPerTask', taskId, revisionCount }
      )
    }

    const revision = this.create({
      projectId: original.projectId,
      title: `${stripRevisionPrefix(original.title)} (revision ${revisionCount})`,
      description: original.description,
      agentId: original.agentId,
      parentTaskId: original.parentTaskId,
      createdByAgentId: original.judgeAgentId,
      priority: Math.min(100, original.priority + 10),
      acceptanceCriteria: original.acceptanceCriteria,
      context: {
        ...original.context,
        revisionOf: taskId,
        priorScore: verdict.score,
        issues: verdict.issues,
        requiredChanges: verdict.requiredChanges
      },
      requiresJudge: true,
      judgeAgentId: original.judgeAgentId,
      revisionOfTaskId: taskId,
      revisionCount,
      status: 'READY'
    })

    this.ctx.db
      .update(tasksTable)
      .set({ revisionCount, updatedAt: now() })
      .where(eq(tasksTable.id, taskId))
      .run()

    return revision
  }

  /** Rolls the acceptance-criteria checklist from a verdict back onto the task. */
  applyChecklist(taskId: string, checklist: AcceptanceCriterion[] | undefined): void {
    if (!checklist?.length) return
    const task = this.get(taskId)
    const byId = new Map(checklist.map((c) => [c.id, c]))
    const merged = task.acceptanceCriteria.map((c) => {
      const found = byId.get(c.id)
      return found ? { ...c, met: found.met ?? null, evidence: found.evidence } : c
    })
    this.setCriteria(taskId, merged)
  }

  stats(projectId: string): Record<TaskStatus, number> {
    const rows = this.ctx.db
      .select({ status: tasksTable.status, n: count() })
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId))
      .groupBy(tasksTable.status)
      .all()
    const out = {} as Record<TaskStatus, number>
    for (const r of rows) out[r.status] = r.n
    return out
  }

  /** Recovers tasks left mid-flight by a crash or a hard quit. */
  recoverInterrupted(): number {
    const stuck = this.ctx.db
      .select()
      .from(tasksTable)
      .where(inArray(tasksTable.status, ['RUNNING', 'QUEUED']))
      .all()
    for (const task of stuck) {
      this.ctx.db
        .update(tasksTable)
        .set({
          status: 'READY',
          error: 'Interrupted by application restart; requeued.',
          updatedAt: now()
        })
        .where(eq(tasksTable.id, task.id))
        .run()
      this.ctx.bus.emit({
        type: 'TASK_RETRY',
        projectId: task.projectId,
        taskId: task.id,
        agentId: task.agentId,
        level: 'warn',
        message: `Task "${task.title}" was interrupted by a restart and has been requeued`,
        data: { previousStatus: task.status }
      })
    }
    return stuck.length
  }

  /** Total spend attributable to a task across all its executions. */
  costUsd(taskId: string): number {
    const row = this.ctx.db
      .select({
        micros: sql<number>`coalesce(sum(cost_usd_micros), 0)`
      })
      .from(sql`task_executions`)
      .where(sql`task_id = ${taskId}`)
      .get()
    return (row?.micros ?? 0) / 1_000_000
  }
}

function stripRevisionPrefix(title: string): string {
  return title.replace(/\s*\(revision \d+\)\s*$/, '')
}

export function normalizeCriteria(
  input: Array<string | AcceptanceCriterion>
): AcceptanceCriterion[] {
  return input.map((c, i) =>
    typeof c === 'string'
      ? { id: `AC${i + 1}`, text: c, met: null }
      : { met: null, ...c, id: c.id || `AC${i + 1}` }
  )
}
