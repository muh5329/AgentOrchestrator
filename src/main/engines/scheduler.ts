import type { AppContext } from '../core/context'
import type { ScheduleRow } from '../db/schema'
import { computeNextRun, missedRuns } from '../services/schedule-service'
import { now } from '../util/time'

export interface SchedulerOptions {
  tickMs?: number
}

/**
 * Durable scheduling.
 *
 * Schedules live in SQLite, not in timers, so closing the app does not lose
 * them. On boot the scheduler works out what it missed and applies each
 * schedule's catch-up policy before resuming normal ticking.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly unsubscribes: Array<() => void> = []
  private readonly tickMs: number

  constructor(
    private readonly ctx: AppContext,
    options: SchedulerOptions = {}
  ) {
    this.tickMs = options.tickMs ?? 1000
  }

  start(): void {
    if (this.timer) return
    this.catchUp()
    this.timer = setInterval(() => this.tick(), this.tickMs)

    // Event-triggered schedules fire off the bus rather than the clock.
    this.unsubscribes.push(
      this.ctx.bus.on('*', (event) => {
        if (event.type === 'SCHEDULE_TRIGGERED') return
        for (const schedule of this.ctx.schedules.byEvent(event.type)) {
          this.fire(schedule, now(), { trigger: event.type, eventId: event.id })
        }
      })
    )

    // Dependency schedules fire when the task they watch completes.
    this.unsubscribes.push(
      this.ctx.bus.on('TASK_COMPLETED', (event) => {
        if (!event.taskId) return
        for (const schedule of this.ctx.schedules.listAll()) {
          if (!schedule.enabled) continue
          if (schedule.kind !== 'dependency') continue
          if (schedule.dependsOnTaskId !== event.taskId) continue
          this.fire(schedule, now(), { trigger: 'dependency', taskId: event.taskId })
        }
      })
    )
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const off of this.unsubscribes.splice(0)) off()
  }

  /**
   * Replays what was missed while the process was not running, honouring each
   * schedule's catch-up policy, then realigns nextRunAt to the future.
   */
  catchUp(at: number = now()): number {
    let fired = 0
    for (const schedule of this.ctx.schedules.listAll()) {
      if (!schedule.enabled || schedule.nextRunAt == null) continue
      if (schedule.nextRunAt > at) continue

      const fires = missedRuns(schedule, at)
      for (const when of fires) {
        this.fire(schedule, when, { trigger: 'catchup', missed: true })
        fired += 1
      }

      if (!fires.length) {
        // Policy was "skip": move the schedule forward without running it.
        const next = computeNextRun(schedule, at)
        this.ctx.schedules.update(schedule.id, { nextRunAt: next, enabled: next != null })
      }
    }
    if (fired) {
      this.ctx.bus.emit({
        type: 'SYSTEM',
        level: 'info',
        message: `Scheduler replayed ${fired} missed run${fired === 1 ? '' : 's'} after restart`,
        data: { fired }
      })
    }
    return fired
  }

  private tick(): void {
    const at = now()
    for (const schedule of this.ctx.schedules.due(at)) {
      this.fire(schedule, at, { trigger: 'clock' })
    }
  }

  /** Materialises a schedule's task template into a real, runnable task. */
  fire(schedule: ScheduleRow, at: number, meta: Record<string, unknown> = {}): string | null {
    const template = schedule.taskTemplate ?? {}
    const project = this.ctx.projects.find(schedule.projectId)
    if (!project) return null

    try {
      const task = this.ctx.tasks.create({
        projectId: schedule.projectId,
        agentId: (template.agentId as string) ?? schedule.agentId ?? null,
        createdByAgentId: schedule.createdByAgentId ?? null,
        title: String(template.title ?? schedule.name ?? 'Scheduled task'),
        description: String(template.description ?? ''),
        acceptanceCriteria: (template.acceptanceCriteria as string[]) ?? [],
        priority: Number(template.priority ?? 50),
        requiresJudge: template.requiresJudge !== false,
        scheduleId: schedule.id,
        status: 'READY',
        context: { ...(template.context as Record<string, unknown>), schedule: schedule.id, ...meta }
      })

      this.ctx.schedules.markRan(schedule.id, at)

      this.ctx.bus.emit({
        type: 'SCHEDULE_TRIGGERED',
        projectId: schedule.projectId,
        agentId: schedule.agentId,
        taskId: task.id,
        message: `Schedule "${schedule.name}" fired`,
        data: { scheduleId: schedule.id, at, ...meta }
      })

      return task.id
    } catch (err) {
      this.ctx.bus.emit({
        type: 'SYSTEM',
        projectId: schedule.projectId,
        level: 'error',
        message: `Schedule "${schedule.name}" could not create its task: ${(err as Error).message}`,
        data: { scheduleId: schedule.id }
      })
      this.ctx.schedules.update(schedule.id, { enabled: false })
      return null
    }
  }
}
