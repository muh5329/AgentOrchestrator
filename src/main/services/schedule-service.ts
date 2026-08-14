import parser from 'cron-parser'
import { and, asc, eq, lte } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { schedules as schedulesTable, type ScheduleRow } from '../db/schema'
import { AppError, NotFoundError } from '../core/errors'
import type { CatchupPolicy, ScheduleKind } from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'

export interface CreateScheduleInput {
  projectId: string
  agentId?: string | null
  name?: string
  kind: ScheduleKind
  cron?: string | null
  intervalMs?: number | null
  runAt?: number | null
  eventType?: string | null
  dependsOnTaskId?: string | null
  catchupPolicy?: CatchupPolicy
  taskTemplate: Record<string, unknown>
  enabled?: boolean
  maxRuns?: number | null
  createdByAgentId?: string | null
}

export class ScheduleService {
  constructor(private readonly ctx: AppContext) {}

  create(input: CreateScheduleInput): ScheduleRow {
    this.validate(input)
    const scheduleId = id('sch')
    const ts = now()
    const nextRunAt = computeNextRun(
      { kind: input.kind, cron: input.cron ?? null, intervalMs: input.intervalMs ?? null, runAt: input.runAt ?? null },
      ts
    )

    this.ctx.db
      .insert(schedulesTable)
      .values({
        id: scheduleId,
        projectId: input.projectId,
        agentId: input.agentId ?? null,
        name: input.name ?? String(input.taskTemplate.title ?? 'Scheduled task'),
        kind: input.kind,
        cron: input.cron ?? null,
        intervalMs: input.intervalMs ?? null,
        runAt: input.runAt ?? null,
        eventType: input.eventType ?? null,
        dependsOnTaskId: input.dependsOnTaskId ?? null,
        catchupPolicy: input.catchupPolicy ?? 'run_once',
        taskTemplate: input.taskTemplate,
        enabled: input.enabled ?? true,
        nextRunAt,
        maxRuns: input.maxRuns ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        createdAt: ts,
        updatedAt: ts
      })
      .run()

    this.ctx.bus.emit({
      type: 'SCHEDULE_CREATED',
      projectId: input.projectId,
      agentId: input.agentId ?? null,
      message: `Schedule "${input.name ?? input.kind}" created`,
      data: { scheduleId, kind: input.kind, nextRunAt }
    })

    return this.get(scheduleId)
  }

  private validate(input: CreateScheduleInput): void {
    switch (input.kind) {
      case 'cron':
        if (!input.cron) throw new AppError('A cron schedule needs a cron expression.', 'INVALID')
        try {
          parser.parseExpression(input.cron)
        } catch {
          throw new AppError(`Invalid cron expression: ${input.cron}`, 'INVALID')
        }
        break
      case 'interval':
        if (!input.intervalMs || input.intervalMs < 1000) {
          throw new AppError('An interval schedule needs intervalMs of at least 1000.', 'INVALID')
        }
        break
      case 'once':
        if (!input.runAt) throw new AppError('A one-off schedule needs runAt.', 'INVALID')
        break
      case 'event':
        if (!input.eventType) throw new AppError('An event schedule needs eventType.', 'INVALID')
        break
      case 'dependency':
        if (!input.dependsOnTaskId) {
          throw new AppError('A dependency schedule needs dependsOnTaskId.', 'INVALID')
        }
        break
    }
  }

  get(scheduleId: string): ScheduleRow {
    const row = this.ctx.db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.id, scheduleId))
      .get()
    if (!row) throw new NotFoundError('Schedule', scheduleId)
    return row
  }

  list(projectId: string): ScheduleRow[] {
    return this.ctx.db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.projectId, projectId))
      .orderBy(asc(schedulesTable.nextRunAt))
      .all()
  }

  listAll(): ScheduleRow[] {
    return this.ctx.db.select().from(schedulesTable).all()
  }

  due(at: number = now()): ScheduleRow[] {
    return this.ctx.db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.enabled, true),
          lte(schedulesTable.nextRunAt, at)
        )
      )
      .orderBy(asc(schedulesTable.nextRunAt))
      .all()
      .filter((s) => s.nextRunAt != null)
  }

  byEvent(eventType: string): ScheduleRow[] {
    return this.ctx.db
      .select()
      .from(schedulesTable)
      .where(and(eq(schedulesTable.enabled, true), eq(schedulesTable.eventType, eventType)))
      .all()
  }

  update(scheduleId: string, patch: Partial<ScheduleRow>): ScheduleRow {
    this.get(scheduleId)
    this.ctx.db
      .update(schedulesTable)
      .set({ ...patch, updatedAt: now() })
      .where(eq(schedulesTable.id, scheduleId))
      .run()
    return this.get(scheduleId)
  }

  setEnabled(scheduleId: string, enabled: boolean): ScheduleRow {
    return this.update(scheduleId, { enabled })
  }

  delete(scheduleId: string): void {
    this.ctx.db.delete(schedulesTable).where(eq(schedulesTable.id, scheduleId)).run()
  }

  markRan(scheduleId: string, at: number = now()): ScheduleRow {
    const schedule = this.get(scheduleId)
    const runCount = schedule.runCount + 1
    const exhausted = schedule.maxRuns != null && runCount >= schedule.maxRuns
    const next =
      schedule.kind === 'once' || exhausted
        ? null
        : computeNextRun(schedule, at)
    return this.update(scheduleId, {
      lastRunAt: at,
      runCount,
      nextRunAt: next,
      enabled: next != null
    })
  }
}

/** Pure next-run computation, shared by the service and its tests. */
export function computeNextRun(
  schedule: Pick<ScheduleRow, 'kind' | 'cron' | 'intervalMs' | 'runAt'>,
  from: number
): number | null {
  switch (schedule.kind) {
    case 'once':
      return schedule.runAt ?? null
    case 'interval':
      return schedule.intervalMs ? from + schedule.intervalMs : null
    case 'cron': {
      if (!schedule.cron) return null
      try {
        const it = parser.parseExpression(schedule.cron, { currentDate: new Date(from) })
        return it.next().getTime()
      } catch {
        return null
      }
    }
    default:
      // Event and dependency schedules are triggered by the bus, not the clock.
      return null
  }
}

/**
 * How many firings a schedule missed while the app was closed, and what should
 * happen about them.
 */
export function missedRuns(
  schedule: Pick<ScheduleRow, 'kind' | 'cron' | 'intervalMs' | 'runAt' | 'nextRunAt' | 'catchupPolicy'>,
  at: number,
  cap = 100
): number[] {
  if (schedule.nextRunAt == null || schedule.nextRunAt > at) return []

  const fires: number[] = []
  let cursor = schedule.nextRunAt
  while (cursor <= at && fires.length < cap) {
    fires.push(cursor)
    const next = computeNextRun(schedule, cursor)
    if (next == null || next <= cursor) break
    cursor = next
  }

  if (schedule.catchupPolicy === 'skip') return []
  if (schedule.catchupPolicy === 'run_once') return fires.slice(-1)
  return fires
}
