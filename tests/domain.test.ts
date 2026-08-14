import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, scriptedProject, type TestApp } from './helpers'

let app: TestApp

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  await app.dispose()
})

describe('projects', () => {
  it('creates a project with a built-in Orchestrator and Judge', () => {
    const project = scriptedProject(app)
    const agents = app.ctx.agents.list(project.id)

    expect(agents).toHaveLength(2)
    expect(agents.map((a) => a.role).sort()).toEqual(['judge', 'orchestrator'])
    expect(agents.every((a) => a.isBuiltIn)).toBe(true)
    expect(app.ctx.agents.orchestratorFor(project.id)?.name).toBe('Orchestrator')
  })

  it('gives built-in agents working toolkits', () => {
    const project = scriptedProject(app)
    const orchestrator = app.ctx.agents.orchestratorFor(project.id)!
    const tools = app.ctx.tools.toolsForAgent(orchestrator.id).map((t) => t.name)

    expect(tools).toContain('create_agent')
    expect(tools).toContain('invoke_agent')
    // Core tools arrive without being assigned.
    expect(tools).toContain('complete_task')
    expect(tools).toContain('report_blocked')
  })

  it('reports stats and completion honestly', () => {
    const project = scriptedProject(app)
    expect(app.ctx.projects.isComplete(project.id)).toBe(false)

    const agent = app.ctx.agents.orchestratorFor(project.id)!
    const task = app.ctx.tasks.create({
      projectId: project.id,
      agentId: agent.id,
      title: 'Do a thing'
    })

    expect(app.ctx.projects.stats(project.id).tasksTotal).toBe(1)
    expect(app.ctx.projects.isComplete(project.id)).toBe(false)

    app.ctx.tasks.setStatus(task.id, 'COMPLETED')
    expect(app.ctx.projects.isComplete(project.id)).toBe(true)
    expect(app.ctx.projects.stats(project.id).progress).toBe(1)
  })
})

describe('agents', () => {
  it('enforces the depth limit', () => {
    const project = scriptedProject(app, {
      settings: { defaultProvider: 'scripted', limits: { maxDepth: 2 } }
    })
    const root = app.ctx.agents.orchestratorFor(project.id)!

    const child = app.ctx.agents.create({
      projectId: project.id,
      name: 'Child',
      parentAgentId: root.id
    })
    const grandchild = app.ctx.agents.create({
      projectId: project.id,
      name: 'Grandchild',
      parentAgentId: child.id
    })
    expect(grandchild.depth).toBe(2)

    expect(() =>
      app.ctx.agents.create({
        projectId: project.id,
        name: 'Too deep',
        parentAgentId: grandchild.id
      })
    ).toThrowError(/depth 3 exceeds/i)
  })

  it('enforces the per-parent child limit', () => {
    const project = scriptedProject(app, {
      settings: { defaultProvider: 'scripted', limits: { maxChildrenPerAgent: 2 } }
    })
    const root = app.ctx.agents.orchestratorFor(project.id)!

    app.ctx.agents.create({ projectId: project.id, name: 'A', parentAgentId: root.id })
    app.ctx.agents.create({ projectId: project.id, name: 'B', parentAgentId: root.id })

    expect(() =>
      app.ctx.agents.create({ projectId: project.id, name: 'C', parentAgentId: root.id })
    ).toThrowError(/already has 2 children/i)
  })

  it('enforces the total agent budget', () => {
    const project = scriptedProject(app, {
      settings: { defaultProvider: 'scripted', limits: { maxTotalAgents: 3 } }
    })
    app.ctx.agents.create({ projectId: project.id, name: 'Third' })
    expect(() => app.ctx.agents.create({ projectId: project.id, name: 'Fourth' })).toThrowError(
      /limit 3/i
    )
  })

  it('supports arbitrary depth when limits allow it', () => {
    const project = scriptedProject(app, {
      settings: { defaultProvider: 'scripted', limits: { maxDepth: 12, maxTotalAgents: 40 } }
    })
    let parent = app.ctx.agents.orchestratorFor(project.id)!
    for (let i = 1; i <= 10; i++) {
      parent = app.ctx.agents.create({
        projectId: project.id,
        name: `Level ${i}`,
        parentAgentId: parent.id
      })
      expect(parent.depth).toBe(i)
    }
    expect(app.ctx.agents.descendants(app.ctx.agents.orchestratorFor(project.id)!.id)).toHaveLength(10)
    expect(app.ctx.agents.ancestors(parent.id)).toHaveLength(10)
  })

  it('deletes a subtree', () => {
    const project = scriptedProject(app)
    const root = app.ctx.agents.create({ projectId: project.id, name: 'Root' })
    const child = app.ctx.agents.create({
      projectId: project.id,
      name: 'Child',
      parentAgentId: root.id
    })
    app.ctx.agents.create({ projectId: project.id, name: 'Grandchild', parentAgentId: child.id })

    const removed = app.ctx.agents.delete(root.id, true)
    expect(removed).toHaveLength(3)
    expect(app.ctx.agents.list(project.id)).toHaveLength(2) // built-ins remain
  })

  it('gives duplicate names a distinct suffix instead of failing', () => {
    const project = scriptedProject(app)
    const first = app.ctx.agents.create({ projectId: project.id, name: 'Worker' })
    const second = app.ctx.agents.create({ projectId: project.id, name: 'Worker' })
    expect(first.name).toBe('Worker')
    expect(second.name).toBe('Worker 2')
  })
})

describe('tasks', () => {
  it('blocks on dependencies and releases when they complete', () => {
    const project = scriptedProject(app)
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Worker' })

    const first = app.ctx.tasks.create({ projectId: project.id, agentId: agent.id, title: 'First' })
    const second = app.ctx.tasks.create({
      projectId: project.id,
      agentId: agent.id,
      title: 'Second',
      dependsOn: [first.id]
    })

    expect(app.ctx.tasks.get(second.id).status).toBe('BLOCKED')
    expect(app.ctx.tasks.ready(project.id).map((t) => t.id)).toEqual([first.id])

    app.ctx.tasks.setStatus(first.id, 'COMPLETED')
    expect(app.ctx.tasks.get(second.id).status).toBe('READY')
  })

  it('refuses dependency cycles', () => {
    const project = scriptedProject(app)
    const a = app.ctx.tasks.create({ projectId: project.id, title: 'A' })
    const b = app.ctx.tasks.create({ projectId: project.id, title: 'B', dependsOn: [a.id] })
    expect(() => app.ctx.tasks.addDependency(a.id, b.id)).toThrowError(/cycle/i)
  })

  it('requeues tasks interrupted by a restart', () => {
    const project = scriptedProject(app)
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Worker' })
    const task = app.ctx.tasks.create({
      projectId: project.id,
      agentId: agent.id,
      title: 'Interrupted'
    })
    app.ctx.tasks.setStatus(task.id, 'RUNNING')

    expect(app.ctx.tasks.recoverInterrupted()).toBe(1)
    const recovered = app.ctx.tasks.get(task.id)
    expect(recovered.status).toBe('READY')
    expect(recovered.error).toMatch(/restart/i)
  })

  it('normalises acceptance criteria into checkable items', () => {
    const project = scriptedProject(app)
    const task = app.ctx.tasks.create({
      projectId: project.id,
      title: 'With criteria',
      acceptanceCriteria: ['It works', 'It is tested']
    })
    expect(task.acceptanceCriteria).toEqual([
      { id: 'AC1', text: 'It works', met: null },
      { id: 'AC2', text: 'It is tested', met: null }
    ])
  })
})

describe('memory', () => {
  it('ranks relevant memories above noise', () => {
    const project = scriptedProject(app)
    app.ctx.memory.write({
      projectId: project.id,
      content: 'The database is SQLite with Drizzle migrations',
      kind: 'decision',
      importance: 80
    })
    app.ctx.memory.write({
      projectId: project.id,
      content: 'The office coffee machine is broken',
      importance: 10
    })

    const results = app.ctx.memory.query({ projectId: project.id, query: 'database migrations' })
    expect(results[0].content).toMatch(/SQLite/)
  })

  it('replaces a keyed memory instead of duplicating it', () => {
    const project = scriptedProject(app)
    app.ctx.memory.write({ projectId: project.id, key: 'stack', content: 'React' })
    app.ctx.memory.write({ projectId: project.id, key: 'stack', content: 'React and Electron' })
    const all = app.ctx.memory.list(project.id)
    expect(all).toHaveLength(1)
    expect(all[0].content).toBe('React and Electron')
  })
})

describe('permissions', () => {
  it('never lets an agent grant authority it does not hold', () => {
    const project = scriptedProject(app)
    const parent = app.ctx.agents.create({
      projectId: project.id,
      name: 'Limited parent',
      permissions: ['FILES_READ', 'AGENT_CREATE']
    })
    expect(app.ctx.agents.hasPermission(parent.id, 'SHELL_EXECUTE')).toBe(false)

    app.ctx.agents.grant(parent.id, ['SHELL_EXECUTE'])
    expect(app.ctx.agents.hasPermission(parent.id, 'SHELL_EXECUTE')).toBe(true)

    app.ctx.agents.revoke(parent.id, ['SHELL_EXECUTE'])
    expect(app.ctx.agents.hasPermission(parent.id, 'SHELL_EXECUTE')).toBe(false)
  })
})
