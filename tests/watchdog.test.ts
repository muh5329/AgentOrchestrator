import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './helpers'
import { executions } from '../src/main/db/schema'
import { eq } from 'drizzle-orm'

let app: TestApp

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  await app.dispose()
})

/** Puts a RUNNING execution row in place without actually running an agent. */
function fakeRunningExecution(
  ctx: TestApp['ctx'],
  options: { projectId: string; agentId: string; taskId: string; startedAt: number; heartbeatAt: number }
): string {
  const id = `exe_test_${Math.floor(options.heartbeatAt)}_${Math.random().toString(36).slice(2, 8)}`
  ctx.db
    .insert(executions)
    .values({
      id,
      projectId: options.projectId,
      taskId: options.taskId,
      agentId: options.agentId,
      depth: 0,
      status: 'RUNNING',
      provider: 'scripted',
      model: 'test',
      startedAt: options.startedAt,
      heartbeatAt: options.heartbeatAt
    })
    .run()
  return id
}

function scaffold(app: TestApp) {
  const project = app.ctx.projects.create({
    name: 'Watched',
    settings: { defaultProvider: 'scripted' }
  })
  const agent = app.ctx.agents.create({ projectId: project.id, name: 'Worker' })
  const task = app.ctx.tasks.create({
    projectId: project.id,
    agentId: agent.id,
    title: 'Long job',
    status: 'READY'
  })
  return { project, agent, task }
}

describe('the watchdog', () => {
  it('nudges a silent execution, then terminates it if silence continues', async () => {
    const { project, agent, task } = scaffold(app)
    const now = Date.now()
    fakeRunningExecution(app.ctx, {
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      startedAt: now - 5 * 60_000,
      heartbeatAt: now - 4 * 60_000
    })

    const first = await app.ctx.watchdog.sweep(now)
    expect(first).toHaveLength(1)
    expect(first[0].symptom).toBe('no_progress')
    expect(first[0].action).toBe('nudge')

    const second = await app.ctx.watchdog.sweep(now)
    expect(second[0].action).toBe('terminate')
    expect(app.ctx.tasks.get(task.id).status).toBe('FAILED')
    expect(app.ctx.tasks.get(task.id).error).toMatch(/watchdog/i)
  })

  it('terminates an execution that has outlived its runtime limit', async () => {
    const { project, agent, task } = scaffold(app)
    const limits = app.ctx.projects.settings(project.id).limits
    const now = Date.now()
    const executionId = fakeRunningExecution(app.ctx, {
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      startedAt: now - limits.maxRuntimeMsPerExecution - 60_000,
      heartbeatAt: now
    })

    const findings = await app.ctx.watchdog.sweep(now)
    expect(findings[0].symptom).toBe('runtime_exceeded')
    expect(findings[0].action).toBe('terminate')

    const row = app.ctx.db.select().from(executions).where(eq(executions.id, executionId)).get()
    expect(row?.status).toBe('TIMEOUT')
  })

  it('escalates repeated tool failures to a human rather than looping', async () => {
    const { project, agent, task } = scaffold(app)
    const now = Date.now()
    const executionId = fakeRunningExecution(app.ctx, {
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      startedAt: now - 30_000,
      heartbeatAt: now
    })

    for (let i = 0; i < 7; i++) {
      app.ctx.bus.emit({
        type: 'TOOL_FAILED',
        projectId: project.id,
        agentId: agent.id,
        taskId: task.id,
        executionId,
        message: 'write_file failed'
      })
    }

    const findings = await app.ctx.watchdog.sweep(now)
    expect(findings[0].symptom).toBe('repeated_tool_failures')
    expect(findings[0].action).toBe('escalate')
    expect(app.ctx.approvals.pending(project.id)).toHaveLength(1)
  })

  it('leaves healthy executions alone', async () => {
    const { project, agent, task } = scaffold(app)
    const now = Date.now()
    fakeRunningExecution(app.ctx, {
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      startedAt: now - 10_000,
      heartbeatAt: now - 1_000
    })
    expect(await app.ctx.watchdog.sweep(now)).toHaveLength(0)
  })
})

describe('budgets', () => {
  it('stops work once the project cost ceiling is reached', () => {
    const project = app.ctx.projects.create({
      name: 'Expensive',
      settings: { defaultProvider: 'scripted', limits: { maxCostUsdPerProject: 1 } }
    })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Spender' })
    const task = app.ctx.tasks.create({
      projectId: project.id,
      agentId: agent.id,
      title: 'Costly'
    })

    expect(app.ctx.budgets.check({ projectId: project.id }).ok).toBe(true)

    fakeRunningExecution(app.ctx, {
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      startedAt: Date.now(),
      heartbeatAt: Date.now()
    })
    app.ctx.db.update(executions).set({ costUsd: 1_500_000 }).run()

    const check = app.ctx.budgets.check({ projectId: project.id, agentId: agent.id })
    expect(check.ok).toBe(false)
    expect(check.scope).toBe('project')
    expect(check.reason).toMatch(/\$1\.50/)
  })

  it('honours an explicit budget row over the project default', () => {
    const project = app.ctx.projects.create({
      name: 'Metered',
      settings: { defaultProvider: 'scripted' }
    })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Spender' })
    const task = app.ctx.tasks.create({ projectId: project.id, agentId: agent.id, title: 'Work' })

    app.ctx.budgets.set({
      scope: 'agent',
      scopeId: agent.id,
      maxCostUsd: 0.5,
      action: 'terminate'
    })

    fakeRunningExecution(app.ctx, {
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      startedAt: Date.now(),
      heartbeatAt: Date.now()
    })
    app.ctx.db.update(executions).set({ costUsd: 700_000 }).run()

    const check = app.ctx.budgets.check({ projectId: project.id, agentId: agent.id })
    expect(check.ok).toBe(false)
    expect(check.scope).toBe('agent')
    expect(check.action).toBe('terminate')
  })
})
