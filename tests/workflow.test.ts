import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, waitFor, type TestApp } from './helpers'
import { validateWorkflow } from '../src/shared/workflow'
import type { ScriptStep, ScriptTurnContext } from '../src/main/runtime/providers/scripted'

let app: TestApp
let projectId: string

beforeEach(async () => {
  app = await createTestApp({ startEngines: true, tickMs: 20 })
  const project = app.ctx.projects.create({
    name: 'Workflow project',
    settings: { defaultProvider: 'scripted', defaultModel: 'scripted-test', autoJudge: false }
  })
  projectId = project.id

  // Every agent simply completes its task unless a test overrides this.
  app.scripted.setResponder(async ({ request }: ScriptTurnContext): Promise<ScriptStep[]> => {
    if (request.agentName === 'Judge') {
      return [
        {
          type: 'text',
          text: JSON.stringify({
            score: 0.9,
            decision: 'APPROVED',
            criteria: [{ name: 'Correctness', score: 0.9, reason: 'fine' }],
            issues: [],
            requiredChanges: [],
            summary: 'Looks right.'
          })
        },
        { type: 'end' }
      ]
    }
    return [
      { type: 'tool', name: 'complete_task', input: { summary: `${request.agentName} did the work.` } },
      { type: 'end' }
    ]
  })
})

afterEach(async () => {
  await app.dispose()
})

/** Builds a graph in one call: nodes keyed by name, edges by name pairs. */
function buildWorkflow(
  name: string,
  nodes: Array<{ key: string; kind: string; label?: string; config?: Record<string, unknown> }>,
  edges: Array<[string, string, string?]>
): string {
  const workflow = app.ctx.workflows.create({ projectId, name })
  const ids = new Map<string, string>()
  const nodeInputs = nodes.map((n, i) => {
    const nodeId = `wfn_${name.replace(/\W/g, '')}_${n.key}`
    ids.set(n.key, nodeId)
    return {
      id: nodeId,
      kind: n.kind as never,
      label: n.label ?? n.key,
      config: (n.config ?? {}) as never,
      x: 100 + i * 180,
      y: 100
    }
  })
  app.ctx.workflows.saveGraph({
    workflowId: workflow.id,
    nodes: nodeInputs,
    edges: edges.map(([from, to, label], i) => ({
      id: `wfe_${name.replace(/\W/g, '')}_${i}`,
      fromNodeId: ids.get(from) as string,
      toNodeId: ids.get(to) as string,
      label: label ?? null
    }))
  })
  return workflow.id
}

describe('workflow validation', () => {
  it('rejects a graph with no start node', () => {
    const issues = validateWorkflow({
      nodes: [{ id: 'a', kind: 'end', label: 'End', config: {} }],
      edges: []
    })
    expect(issues.some((i) => /no Start node/.test(i.message) && i.severity === 'error')).toBe(true)
  })

  it('requires both branches of a condition', () => {
    const issues = validateWorkflow({
      nodes: [
        { id: 's', kind: 'start', label: 'Start', config: {} },
        { id: 'c', kind: 'condition', label: 'Check', config: { expression: 'true' } },
        { id: 'e', kind: 'end', label: 'End', config: {} }
      ],
      edges: [
        { id: '1', fromNodeId: 's', toNodeId: 'c' },
        { id: '2', fromNodeId: 'c', toNodeId: 'e', label: 'true' }
      ]
    })
    expect(issues.some((i) => /"false" branch/.test(i.message))).toBe(true)
  })

  it('refuses to save a graph with a blocking problem', () => {
    const workflow = app.ctx.workflows.create({ projectId, name: 'Broken' })
    expect(() =>
      app.ctx.workflows.saveGraph({
        workflowId: workflow.id,
        nodes: [{ id: 'n1', kind: 'condition', label: 'No expression', config: {}, x: 0, y: 0 }],
        edges: []
      })
    ).toThrowError(/cannot be saved/i)
  })
})

describe('the workflow engine', () => {
  it('runs a linear graph and records every node', async () => {
    const workflowId = buildWorkflow(
      'linear',
      [
        { key: 'start', kind: 'start' },
        { key: 'delay', kind: 'delay', config: { ms: 10 } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'delay'],
        ['delay', 'end']
      ]
    )

    const result = await app.ctx.workflowEngine.run(workflowId)
    expect(result.status).toBe('COMPLETED')

    const nodeRuns = app.ctx.workflows.nodeRuns(result.runId)
    expect(nodeRuns.map((n) => n.kind)).toEqual(['start', 'delay'])
    expect(nodeRuns.every((n) => n.status === 'COMPLETED')).toBe(true)
  })

  it('takes the branch a condition selects', async () => {
    const workflowId = buildWorkflow(
      'branching',
      [
        { key: 'start', kind: 'start' },
        { key: 'check', kind: 'condition', config: { expression: 'vars.score > 0.5' } },
        { key: 'high', kind: 'delay', label: 'High', config: { ms: 1, saveAs: 'took' } },
        { key: 'low', kind: 'delay', label: 'Low', config: { ms: 1, saveAs: 'took' } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'check'],
        ['check', 'high', 'true'],
        ['check', 'low', 'false'],
        ['high', 'end'],
        ['low', 'end']
      ]
    )

    const high = await app.ctx.workflowEngine.run(workflowId, { variables: { score: 0.9 } })
    expect(
      app.ctx.workflows.nodeRuns(high.runId).map((n) => n.label)
    ).toEqual(['start', 'check', 'High'])

    const low = await app.ctx.workflowEngine.run(workflowId, { variables: { score: 0.1 } })
    expect(app.ctx.workflows.nodeRuns(low.runId).map((n) => n.label)).toEqual([
      'start',
      'check',
      'Low'
    ])
  })

  it('runs parallel branches and rejoins at the merge', async () => {
    const workflowId = buildWorkflow(
      'parallel',
      [
        { key: 'start', kind: 'start' },
        { key: 'fork', kind: 'parallel' },
        { key: 'a', kind: 'delay', label: 'Branch A', config: { ms: 30 } },
        { key: 'b', kind: 'delay', label: 'Branch B', config: { ms: 30 } },
        { key: 'c', kind: 'delay', label: 'Branch C', config: { ms: 30 } },
        { key: 'join', kind: 'merge' },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'fork'],
        ['fork', 'a'],
        ['fork', 'b'],
        ['fork', 'c'],
        ['a', 'join'],
        ['b', 'join'],
        ['c', 'join'],
        ['join', 'end']
      ]
    )

    const startedAt = Date.now()
    const result = await app.ctx.workflowEngine.run(workflowId)
    const elapsed = Date.now() - startedAt

    expect(result.status).toBe('COMPLETED')
    const labels = app.ctx.workflows.nodeRuns(result.runId).map((n) => n.label)
    expect(labels).toContain('Branch A')
    expect(labels).toContain('Branch B')
    expect(labels).toContain('Branch C')
    expect(labels.filter((l) => l === 'Merge' || l === 'join')).toHaveLength(1)
    // Three 30ms branches concurrently, not 90ms in sequence.
    expect(elapsed).toBeLessThan(85)
  })

  it('loops while its condition holds and stops at the maximum', async () => {
    const workflowId = buildWorkflow(
      'looping',
      [
        { key: 'start', kind: 'start' },
        {
          key: 'loop',
          kind: 'loop',
          config: { expression: 'vars.iteration < 3', maxIterations: 10 }
        },
        { key: 'body', kind: 'delay', label: 'Body', config: { ms: 1 } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'loop'],
        ['loop', 'body', 'body'],
        ['body', 'loop'],
        ['loop', 'end', 'done']
      ]
    )

    const result = await app.ctx.workflowEngine.run(workflowId)
    expect(result.status).toBe('COMPLETED')
    expect(result.context.iterations).toBe(3)
    const bodyRuns = app.ctx.workflows.nodeRuns(result.runId).filter((n) => n.label === 'Body')
    expect(bodyRuns).toHaveLength(3)
  })

  it('stops a runaway loop rather than spinning forever', async () => {
    const workflowId = buildWorkflow(
      'runaway',
      [
        { key: 'start', kind: 'start' },
        { key: 'loop', kind: 'loop', config: { expression: 'true', maxIterations: 4 } },
        { key: 'body', kind: 'delay', label: 'Body', config: { ms: 1 } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'loop'],
        ['loop', 'body', 'body'],
        ['body', 'loop'],
        ['loop', 'end', 'done']
      ]
    )

    const result = await app.ctx.workflowEngine.run(workflowId)
    expect(result.status).toBe('COMPLETED')
    expect(result.context.iterations).toBe(4)
  })

  it('runs an agent node through the normal executor and captures its result', async () => {
    const worker = app.ctx.agents.create({ projectId, name: 'Worker' })
    expect(worker.id).toBeTruthy()

    const workflowId = buildWorkflow(
      'agentnode',
      [
        { key: 'start', kind: 'start' },
        {
          key: 'work',
          kind: 'agent',
          label: 'Do the work',
          config: { agent: 'Worker', task: 'Produce the thing', saveAs: 'work' }
        },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'work'],
        ['work', 'end']
      ]
    )

    const result = await app.ctx.workflowEngine.run(workflowId)
    expect(result.status).toBe('COMPLETED')

    const work = result.context.work as { status: string; summary: string; taskId: string }
    expect(work.status).toBe('completed')
    expect(work.summary).toMatch(/Worker did the work/)
    expect(app.ctx.tasks.get(work.taskId).status).toBe('COMPLETED')
  }, 20_000)

  it('substitutes run variables into node configuration', async () => {
    const worker = app.ctx.agents.create({ projectId, name: 'Templater' })
    expect(worker.name).toBe('Templater')

    const workflowId = buildWorkflow(
      'templating',
      [
        { key: 'start', kind: 'start' },
        {
          key: 'work',
          kind: 'agent',
          config: { agent: 'Templater', task: 'Handle {{subject}} carefully', saveAs: 'work' }
        },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'work'],
        ['work', 'end']
      ]
    )

    const result = await app.ctx.workflowEngine.run(workflowId, {
      variables: { subject: 'the ledger' }
    })
    const taskId = (result.context.work as { taskId: string }).taskId
    expect(app.ctx.tasks.get(taskId).description).toBe('Handle the ledger carefully')
  }, 20_000)

  it('waits for a human at an approval node and follows the denied branch', async () => {
    const workflowId = buildWorkflow(
      'approvals',
      [
        { key: 'start', kind: 'start' },
        {
          key: 'ask',
          kind: 'approval',
          label: 'Ask first',
          config: { action: 'Deploy to production', reason: 'Irreversible.' }
        },
        { key: 'yes', kind: 'delay', label: 'Deployed', config: { ms: 1 } },
        { key: 'no', kind: 'delay', label: 'Skipped', config: { ms: 1 } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'ask'],
        ['ask', 'yes', 'approved'],
        ['ask', 'no', 'denied'],
        ['yes', 'end'],
        ['no', 'end']
      ]
    )

    const runPromise = app.ctx.workflowEngine.run(workflowId)

    await waitFor(() => app.ctx.approvals.pending(projectId).length === 1, { timeoutMs: 5000 })
    const approval = app.ctx.approvals.pending(projectId)[0]
    expect(approval.action).toBe('Deploy to production')
    app.ctx.approvals.resolve(approval.id, false, 'Not today.')

    const result = await runPromise
    expect(result.status).toBe('COMPLETED')
    const labels = app.ctx.workflows.nodeRuns(result.runId).map((n) => n.label)
    expect(labels).toContain('Skipped')
    expect(labels).not.toContain('Deployed')
  }, 20_000)

  it('fires an event-triggered workflow from the bus', async () => {
    const workflowId = buildWorkflow(
      'reactive',
      [
        { key: 'start', kind: 'start' },
        { key: 'note', kind: 'delay', label: 'Reacted', config: { ms: 1 } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'note'],
        ['note', 'end']
      ]
    )
    app.ctx.workflows.update(workflowId, { trigger: 'event', eventType: 'TASK_FAILED' })

    const agent = app.ctx.agents.create({ projectId, name: 'Doomed worker' })
    const task = app.ctx.tasks.create({ projectId, agentId: agent.id, title: 'Doomed' })
    app.ctx.tasks.setStatus(task.id, 'FAILED', { error: 'boom' })

    await waitFor(() => app.ctx.workflows.listRuns(workflowId).length > 0, { timeoutMs: 8000 })
    const run = app.ctx.workflows.listRuns(workflowId)[0]
    expect(run.trigger).toBe('event:TASK_FAILED')
  }, 20_000)

  it('surfaces a failing node instead of finishing quietly', async () => {
    const workflowId = buildWorkflow(
      'failing',
      [
        { key: 'start', kind: 'start' },
        { key: 'boom', kind: 'webhook', label: 'Bad call', config: { url: 'not-a-url' } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'boom'],
        ['boom', 'end']
      ]
    )

    const result = await app.ctx.workflowEngine.run(workflowId)
    expect(result.status).toBe('FAILED')
    expect(result.error).toMatch(/not an http/i)

    const failed = app.ctx.workflows.nodeRuns(result.runId).find((n) => n.label === 'Bad call')
    expect(failed?.status).toBe('FAILED')
    expect(app.ctx.workflows.getRun(result.runId).status).toBe('FAILED')
  })
})

describe('agents driving workflows', () => {
  it('lets an agent run a workflow as a tool', async () => {
    const workflowId = buildWorkflow(
      'agentdriven',
      [
        { key: 'start', kind: 'start' },
        { key: 'work', kind: 'delay', label: 'Automated step', config: { ms: 5 } },
        { key: 'end', kind: 'end' }
      ],
      [
        ['start', 'work'],
        ['work', 'end']
      ]
    )
    app.ctx.workflows.update(workflowId, { name: 'Nightly sweep' })

    const agent = app.ctx.agents.create({
      projectId,
      name: 'Automator',
      permissions: ['TASK_CREATE'],
      toolkitNames: ['Automation']
    })

    let toolOutput = ''
    app.scripted.setResponder(async ({ turn, lastResults }): Promise<ScriptStep[]> => {
      if (turn === 1) {
        return [{ type: 'tool', name: 'run_workflow', input: { workflow: 'Nightly sweep' } }]
      }
      toolOutput = lastResults[0]?.content ?? ''
      return [
        { type: 'tool', name: 'complete_task', input: { summary: 'Ran the sweep.' } },
        { type: 'end' }
      ]
    })

    const task = app.ctx.tasks.create({
      projectId,
      agentId: agent.id,
      title: 'Run the nightly sweep',
      requiresJudge: false,
      status: 'READY'
    })

    await waitFor(() => app.ctx.tasks.get(task.id).status === 'COMPLETED', { timeoutMs: 15_000 })
    expect(toolOutput).toMatch(/Nightly sweep.*completed/i)
    expect(app.ctx.workflows.listRuns(workflowId)).toHaveLength(1)
  }, 25_000)
})
