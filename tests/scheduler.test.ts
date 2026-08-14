import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, waitFor, type TestApp } from './helpers'
import { computeNextRun, missedRuns } from '../src/main/services/schedule-service'
import type { ScheduleRow } from '../src/main/db/schema'

let app: TestApp

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  await app.dispose()
})

const base = (overrides: Partial<ScheduleRow>): Pick<
  ScheduleRow,
  'kind' | 'cron' | 'intervalMs' | 'runAt' | 'nextRunAt' | 'catchupPolicy'
> => ({
  kind: 'interval',
  cron: null,
  intervalMs: 60_000,
  runAt: null,
  nextRunAt: null,
  catchupPolicy: 'run_once',
  ...overrides
})

describe('next-run computation', () => {
  const t0 = Date.UTC(2026, 0, 1, 9, 0, 0)

  it('handles intervals', () => {
    expect(computeNextRun(base({ intervalMs: 5000 }), t0)).toBe(t0 + 5000)
  })

  it('handles cron expressions', () => {
    const next = computeNextRun(base({ kind: 'cron', cron: '0 10 * * *' }), t0)
    expect(next).toBe(Date.UTC(2026, 0, 1, 10, 0, 0))
  })

  it('handles one-off times', () => {
    expect(computeNextRun(base({ kind: 'once', runAt: t0 + 1000 }), t0)).toBe(t0 + 1000)
  })

  it('returns null for event and dependency schedules', () => {
    expect(computeNextRun(base({ kind: 'event' }), t0)).toBeNull()
    expect(computeNextRun(base({ kind: 'dependency' }), t0)).toBeNull()
  })

  it('rejects an invalid cron expression rather than silently never firing', () => {
    const project = app.ctx.projects.create({ name: 'Cron' })
    expect(() =>
      app.ctx.schedules.create({
        projectId: project.id,
        kind: 'cron',
        cron: 'not a cron',
        taskTemplate: { title: 'x', description: 'y' }
      })
    ).toThrowError(/Invalid cron/)
  })
})

describe('catch-up policy', () => {
  const t0 = Date.UTC(2026, 0, 1, 9, 0, 0)
  const threeHoursLater = t0 + 3 * 3_600_000

  it('run_all replays every missed firing', () => {
    const fires = missedRuns(
      base({ intervalMs: 3_600_000, nextRunAt: t0, catchupPolicy: 'run_all' }),
      threeHoursLater
    )
    expect(fires).toHaveLength(4)
  })

  it('run_once collapses them to the most recent', () => {
    const fires = missedRuns(
      base({ intervalMs: 3_600_000, nextRunAt: t0, catchupPolicy: 'run_once' }),
      threeHoursLater
    )
    expect(fires).toHaveLength(1)
    expect(fires[0]).toBe(threeHoursLater)
  })

  it('skip runs nothing', () => {
    expect(
      missedRuns(base({ intervalMs: 3_600_000, nextRunAt: t0, catchupPolicy: 'skip' }), threeHoursLater)
    ).toHaveLength(0)
  })

  it('does not fire a schedule whose time has not come', () => {
    expect(missedRuns(base({ nextRunAt: threeHoursLater }), t0)).toHaveLength(0)
  })
})

describe('the scheduler engine', () => {
  it('creates a task when a schedule fires and advances the next run', () => {
    const project = app.ctx.projects.create({ name: 'Scheduled' })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Runner' })
    const schedule = app.ctx.schedules.create({
      projectId: project.id,
      agentId: agent.id,
      kind: 'interval',
      intervalMs: 60_000,
      name: 'Hourly sweep',
      taskTemplate: { title: 'Sweep', description: 'Check things', agentId: agent.id }
    })

    const taskId = app.ctx.scheduler.fire(app.ctx.schedules.get(schedule.id), Date.now())
    expect(taskId).toBeTruthy()

    const task = app.ctx.tasks.get(taskId as string)
    expect(task.title).toBe('Sweep')
    expect(task.scheduleId).toBe(schedule.id)

    const after = app.ctx.schedules.get(schedule.id)
    expect(after.runCount).toBe(1)
    expect(after.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('stops a one-off schedule after it fires', () => {
    const project = app.ctx.projects.create({ name: 'Once' })
    const schedule = app.ctx.schedules.create({
      projectId: project.id,
      kind: 'once',
      runAt: Date.now() - 1000,
      taskTemplate: { title: 'Just once', description: '' }
    })
    app.ctx.scheduler.fire(app.ctx.schedules.get(schedule.id), Date.now())
    const after = app.ctx.schedules.get(schedule.id)
    expect(after.enabled).toBe(false)
    expect(after.nextRunAt).toBeNull()
  })

  it('fires event-triggered schedules off the bus', async () => {
    app.ctx.scheduler.start()
    const project = app.ctx.projects.create({ name: 'Reactive' })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Responder' })
    app.ctx.schedules.create({
      projectId: project.id,
      agentId: agent.id,
      kind: 'event',
      eventType: 'TASK_FAILED',
      taskTemplate: { title: 'Investigate the failure', description: '', agentId: agent.id }
    })

    const failing = app.ctx.tasks.create({
      projectId: project.id,
      agentId: agent.id,
      title: 'Doomed'
    })
    app.ctx.tasks.setStatus(failing.id, 'FAILED', { error: 'boom' })

    await waitFor(() =>
      app.ctx.tasks.list(project.id).some((t) => t.title === 'Investigate the failure')
    )
    app.ctx.scheduler.stop()
  })

  it('fires dependency schedules when the watched task completes', async () => {
    app.ctx.scheduler.start()
    const project = app.ctx.projects.create({ name: 'Chained' })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Next' })
    const watched = app.ctx.tasks.create({
      projectId: project.id,
      agentId: agent.id,
      title: 'First'
    })
    app.ctx.schedules.create({
      projectId: project.id,
      agentId: agent.id,
      kind: 'dependency',
      dependsOnTaskId: watched.id,
      taskTemplate: { title: 'Follow-up', description: '', agentId: agent.id }
    })

    app.ctx.tasks.setStatus(watched.id, 'COMPLETED')
    await waitFor(() => app.ctx.tasks.list(project.id).some((t) => t.title === 'Follow-up'))
    app.ctx.scheduler.stop()
  })
})

describe('surviving a restart', () => {
  it('keeps projects, agents, schedules and memory, and replays what it missed', async () => {
    const dir = app.tmpDir
    const projectId = (() => {
      const project = app.ctx.projects.create({
        name: 'Durable',
        mission: 'Outlive the process',
        settings: { defaultProvider: 'scripted' }
      })
      const agent = app.ctx.agents.create({
        projectId: project.id,
        name: 'Persistent worker',
        parentAgentId: app.ctx.agents.orchestratorFor(project.id)!.id
      })
      app.ctx.memory.write({
        projectId: project.id,
        content: 'Remember me across restarts',
        key: 'durable'
      })
      // A schedule that should already have fired by the time we come back.
      app.ctx.schedules.create({
        projectId: project.id,
        agentId: agent.id,
        kind: 'interval',
        intervalMs: 60_000,
        name: 'Recurring work',
        catchupPolicy: 'run_once',
        taskTemplate: { title: 'Recurring work', description: '', agentId: agent.id }
      })
      app.handle.sqlite
        .prepare('update schedules set next_run_at = ?')
        .run(Date.now() - 10 * 60_000)

      // A task caught mid-flight.
      const running = app.ctx.tasks.create({
        projectId: project.id,
        agentId: agent.id,
        title: 'In flight'
      })
      app.ctx.tasks.setStatus(running.id, 'RUNNING')
      return project.id
    })()

    await app.close()

    const restarted = await createTestApp({ dir, startEngines: false, keepDir: true })
    try {
      const project = restarted.ctx.projects.get(projectId)
      expect(project.mission).toBe('Outlive the process')
      expect(restarted.ctx.agents.list(projectId).map((a) => a.name)).toContain('Persistent worker')
      expect(restarted.ctx.memory.list(projectId)[0].content).toBe('Remember me across restarts')

      // The interrupted task was requeued rather than left hanging.
      const inFlight = restarted.ctx.tasks.list(projectId).find((t) => t.title === 'In flight')!
      expect(inFlight.status).toBe('READY')
      expect(inFlight.error).toMatch(/restart/i)

      // The scheduler replayed the missed firing.
      const replayed = restarted.ctx.scheduler.catchUp()
      expect(replayed).toBeGreaterThanOrEqual(1)
      expect(
        restarted.ctx.tasks.list(projectId).filter((t) => t.title === 'Recurring work').length
      ).toBeGreaterThanOrEqual(1)
    } finally {
      await restarted.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
