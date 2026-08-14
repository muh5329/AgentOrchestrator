import { and, eq, sql } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { budgets as budgetsTable, executions as executionsTable, type BudgetRow } from '../db/schema'
import { id } from '../util/id'
import { now } from '../util/time'

export type BudgetScope = 'global' | 'project' | 'agent' | 'task'
export type BudgetAction = 'pause' | 'fallback' | 'ask' | 'terminate'

export interface BudgetCheck {
  ok: boolean
  action: BudgetAction | null
  reason: string | null
  scope: BudgetScope | null
  spentUsd: number
  limitUsd: number | null
}

export interface SetBudgetInput {
  scope: BudgetScope
  scopeId?: string | null
  maxCostUsd?: number | null
  maxTokens?: number | null
  maxRuntimeMs?: number | null
  maxToolCalls?: number | null
  action?: BudgetAction
  period?: 'total' | 'daily'
}

/**
 * Spend tracking and enforcement.
 *
 * Costs are stored as integer micro-dollars so accumulating thousands of small
 * executions never drifts through float rounding.
 */
export class BudgetService {
  constructor(private readonly ctx: AppContext) {}

  set(input: SetBudgetInput): BudgetRow {
    const existing = this.find(input.scope, input.scopeId ?? null)
    const values = {
      maxCostUsdMicros: input.maxCostUsd == null ? null : Math.round(input.maxCostUsd * 1_000_000),
      maxTokens: input.maxTokens ?? null,
      maxRuntimeMs: input.maxRuntimeMs ?? null,
      maxToolCalls: input.maxToolCalls ?? null,
      action: input.action ?? 'pause',
      period: input.period ?? 'total',
      updatedAt: now()
    }
    if (existing) {
      this.ctx.db.update(budgetsTable).set(values).where(eq(budgetsTable.id, existing.id)).run()
      return this.get(existing.id)
    }
    const budgetId = id('bdg')
    this.ctx.db
      .insert(budgetsTable)
      .values({
        id: budgetId,
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        periodStart: now(),
        createdAt: now(),
        ...values
      })
      .run()
    return this.get(budgetId)
  }

  get(budgetId: string): BudgetRow {
    return this.ctx.db.select().from(budgetsTable).where(eq(budgetsTable.id, budgetId)).get()!
  }

  find(scope: BudgetScope, scopeId: string | null): BudgetRow | undefined {
    return this.ctx.db
      .select()
      .from(budgetsTable)
      .where(
        and(
          eq(budgetsTable.scope, scope),
          scopeId == null ? sql`scope_id is null` : eq(budgetsTable.scopeId, scopeId)
        )
      )
      .get()
  }

  list(): BudgetRow[] {
    return this.ctx.db.select().from(budgetsTable).all()
  }

  spentUsd(scope: BudgetScope, scopeId: string | null): number {
    if (scope === 'global') {
      const row = this.ctx.db
        .select({ micros: sql<number>`coalesce(sum(cost_usd_micros), 0)` })
        .from(executionsTable)
        .get()
      return (row?.micros ?? 0) / 1_000_000
    }
    const column =
      scope === 'project'
        ? executionsTable.projectId
        : scope === 'agent'
          ? executionsTable.agentId
          : executionsTable.taskId
    const row = this.ctx.db
      .select({ micros: sql<number>`coalesce(sum(cost_usd_micros), 0)` })
      .from(executionsTable)
      .where(eq(column, scopeId ?? ''))
      .get()
    return (row?.micros ?? 0) / 1_000_000
  }

  /**
   * Checks every budget that applies to an execution, plus the project's own
   * per-task and per-project cost ceilings from its safety limits.
   */
  check(params: { projectId: string; agentId?: string; taskId?: string }): BudgetCheck {
    const limits = this.ctx.projects.settings(params.projectId).limits

    const projectSpend = this.spentUsd('project', params.projectId)
    if (projectSpend >= limits.maxCostUsdPerProject) {
      return {
        ok: false,
        action: 'pause',
        reason: `Project spend $${projectSpend.toFixed(2)} reached the $${limits.maxCostUsdPerProject.toFixed(2)} project limit.`,
        scope: 'project',
        spentUsd: projectSpend,
        limitUsd: limits.maxCostUsdPerProject
      }
    }

    if (params.taskId) {
      const taskSpend = this.spentUsd('task', params.taskId)
      if (taskSpend >= limits.maxCostUsdPerTask) {
        return {
          ok: false,
          action: 'ask',
          reason: `Task spend $${taskSpend.toFixed(2)} reached the $${limits.maxCostUsdPerTask.toFixed(2)} task limit.`,
          scope: 'task',
          spentUsd: taskSpend,
          limitUsd: limits.maxCostUsdPerTask
        }
      }
    }

    const scopes: Array<[BudgetScope, string | null]> = [
      ['global', null],
      ['project', params.projectId],
      ['agent', params.agentId ?? null],
      ['task', params.taskId ?? null]
    ]

    for (const [scope, scopeId] of scopes) {
      if (scope !== 'global' && !scopeId) continue
      const budget = this.find(scope, scopeId)
      if (!budget?.maxCostUsdMicros) continue
      const spent = this.spentUsd(scope, scopeId)
      const limit = budget.maxCostUsdMicros / 1_000_000
      if (spent >= limit) {
        return {
          ok: false,
          action: budget.action as BudgetAction,
          reason: `${scope} budget of $${limit.toFixed(2)} exhausted ($${spent.toFixed(2)} spent).`,
          scope,
          spentUsd: spent,
          limitUsd: limit
        }
      }
      if (spent >= limit * 0.8) {
        this.ctx.bus.emit({
          type: 'BUDGET_WARNING',
          projectId: params.projectId,
          agentId: params.agentId ?? null,
          taskId: params.taskId ?? null,
          level: 'warn',
          message: `${scope} budget ${Math.round((spent / limit) * 100)}% consumed`,
          data: { scope, spent, limit }
        })
      }
    }

    return {
      ok: true,
      action: null,
      reason: null,
      scope: null,
      spentUsd: projectSpend,
      limitUsd: limits.maxCostUsdPerProject
    }
  }

  reportExceeded(params: {
    projectId: string
    agentId?: string | null
    taskId?: string | null
    check: BudgetCheck
  }): void {
    this.ctx.bus.emit({
      type: 'BUDGET_EXCEEDED',
      projectId: params.projectId,
      agentId: params.agentId ?? null,
      taskId: params.taskId ?? null,
      level: 'error',
      message: params.check.reason ?? 'Budget exceeded',
      data: { ...params.check }
    })
  }
}
