import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, waitFor, type TestApp } from './helpers'
import type { ScriptStep, ScriptTurnContext } from '../src/main/runtime/providers/scripted'

let app: TestApp

beforeEach(async () => {
  app = await createTestApp({ startEngines: true, tickMs: 20 })
})

afterEach(async () => {
  await app.dispose()
})

function verdict(input: {
  score: number
  decision: string
  issues?: string[]
  requiredChanges?: string[]
  summary: string
}): string {
  return JSON.stringify({
    score: input.score,
    decision: input.decision,
    criteria: [
      { name: 'Correctness', score: input.score, reason: 'as observed' },
      { name: 'Completeness', score: input.score, reason: 'as observed' },
      { name: 'Tests', score: input.score, reason: 'as observed' },
      { name: 'Quality', score: input.score, reason: 'as observed' },
      { name: 'Security', score: input.score, reason: 'as observed' },
      { name: 'Performance', score: input.score, reason: 'as observed' },
      { name: 'Requirements', score: input.score, reason: 'as observed' }
    ],
    issues: input.issues ?? [],
    requiredChanges: input.requiredChanges ?? [],
    summary: input.summary
  })
}

/**
 * The scenario from the product's definition of done, driven by a deterministic
 * provider so it can run in CI: the Orchestrator staffs a fleet, a worker spawns
 * a child of its own and invokes a peer, the Judge rejects the first attempt,
 * a revision is created and executed, and the second attempt is approved.
 */
describe('the recursive orchestration loop', () => {
  it('plans, spawns, delegates, judges, revises and completes', async () => {
    const judgeCounts = new Map<string, number>()

    app.scripted.setResponder(async (turnCtx: ScriptTurnContext): Promise<ScriptStep[]> => {
      const { request, turn } = turnCtx
      const agent = request.agentName
      const prompt = request.prompt

      if (agent === 'Judge') {
        const isBuilderWork = /Build the greeting module/.test(prompt)
        const key = isBuilderWork ? 'builder' : 'other'
        const seen = (judgeCounts.get(key) ?? 0) + 1
        judgeCounts.set(key, seen)

        if (isBuilderWork && seen === 1) {
          return [
            {
              type: 'text',
              text: verdict({
                score: 0.45,
                decision: 'REJECTED',
                issues: ['greeting.js exists but has no test'],
                requiredChanges: ['Add greeting.test.js covering the empty-name case'],
                summary: 'The module works but is untested.'
              })
            },
            { type: 'end' }
          ]
        }
        return [
          {
            type: 'text',
            text: verdict({ score: 0.93, decision: 'APPROVED', summary: 'Meets every criterion.' })
          },
          { type: 'end' }
        ]
      }

      if (agent === 'Orchestrator') {
        if (turn === 1) {
          return [
            { type: 'text', text: 'Reading the mission and staffing a fleet.' },
            { type: 'tool', name: 'project_status', input: {} },
            {
              type: 'tool',
              name: 'create_agent',
              input: {
                name: 'Builder',
                description: 'Writes the implementation.',
                system_prompt: 'You implement modules and verify them.',
                permissions: ['FILES_READ', 'FILES_WRITE', 'AGENT_CREATE', 'AGENT_INVOKE', 'AGENT_MESSAGE', 'MEMORY_WRITE'],
                toolkits: ['Filesystem', 'Knowledge', 'Orchestration']
              }
            },
            {
              type: 'tool',
              name: 'create_agent',
              input: {
                name: 'Reviewer',
                description: 'Reviews implementations for defects.',
                system_prompt: 'You review code and report concrete defects.',
                permissions: ['FILES_READ', 'AGENT_MESSAGE'],
                toolkits: ['Inspection', 'Knowledge']
              }
            },
            {
              type: 'tool',
              name: 'remember',
              input: {
                content: 'The greeting module lives at src/greeting.js',
                kind: 'decision',
                shared: 'project'
              }
            }
          ]
        }
        if (turn === 2) {
          return [
            {
              type: 'tool',
              name: 'delegate_task',
              input: {
                agent: 'Builder',
                title: 'Build the greeting module',
                description: 'Write src/greeting.js exporting greet(name), and a test for it.',
                acceptance_criteria: [
                  'src/greeting.js exists and exports greet',
                  'A test covers the empty-name case'
                ],
                priority: 70
              }
            }
          ]
        }
        return [
          {
            type: 'tool',
            name: 'complete_task',
            input: {
              summary: 'Staffed Builder and Reviewer and delegated the implementation task.'
            }
          },
          { type: 'end' }
        ]
      }

      if (agent === 'Builder') {
        const isRevision = /Revision \(attempt/.test(prompt)
        if (turn === 1 && !isRevision) {
          return [
            { type: 'text', text: 'Implementing, then asking for a second pair of eyes.' },
            {
              type: 'tool',
              name: 'create_agent',
              input: {
                name: 'Docs Writer',
                description: 'Writes documentation for modules.',
                system_prompt: 'You write concise module documentation.',
                permissions: ['FILES_READ', 'FILES_WRITE'],
                toolkits: ['Filesystem']
              }
            },
            {
              type: 'tool',
              name: 'write_file',
              input: {
                path: 'src/greeting.js',
                content: 'export function greet(name) { return `Hello, ${name}!` }\n'
              }
            },
            {
              type: 'tool',
              name: 'invoke_agent',
              input: {
                agent: 'Reviewer',
                task: 'Review src/greeting.js for defects',
                acceptance_criteria: ['A verdict on the implementation is given']
              }
            },
            {
              type: 'tool',
              name: 'complete_task',
              input: {
                summary: 'Wrote src/greeting.js and had it reviewed.',
                artifacts: ['src/greeting.js']
              }
            },
            { type: 'end' }
          ]
        }
        // Revision: address exactly what the Judge asked for.
        return [
          {
            type: 'tool',
            name: 'write_file',
            input: {
              path: 'src/greeting.test.js',
              content: "test('empty name', () => { expect(greet('')).toBe('Hello, !') })\n"
            }
          },
          {
            type: 'tool',
            name: 'complete_task',
            input: {
              summary: 'Added greeting.test.js covering the empty-name case.',
              artifacts: ['src/greeting.test.js']
            }
          },
          { type: 'end' }
        ]
      }

      if (agent === 'Reviewer') {
        return [
          { type: 'tool', name: 'read_file', input: { path: 'src/greeting.js' } },
          {
            type: 'tool',
            name: 'complete_task',
            input: { summary: 'greet() is correct but there is no test for it.' }
          },
          { type: 'end' }
        ]
      }

      if (agent === 'Docs Writer') {
        return [
          {
            type: 'tool',
            name: 'write_file',
            input: { path: 'docs/greeting.md', content: '# greeting\n' }
          },
          { type: 'tool', name: 'complete_task', input: { summary: 'Documented greeting.' } },
          { type: 'end' }
        ]
      }

      return [{ type: 'end' }]
    })

    const { project } = app.ctx.orchestrator.createFromMission({
      name: 'Greeting library',
      mission: 'Ship a tiny, well-tested greeting module.',
      templateId: 'software',
      settings: { defaultProvider: 'scripted', defaultModel: 'scripted-test' },
      acceptanceCriteria: ['A greeting module exists', 'It has a test']
    })

    // The whole fleet settles: every task reaches a terminal state.
    await waitFor(
      () => {
        const tasks = app.ctx.tasks.list(project.id)
        return (
          tasks.length >= 3 &&
          tasks.every((t) => ['COMPLETED', 'CANCELLED', 'FAILED'].includes(t.status)) &&
          app.ctx.executor.activeCount === 0
        )
      },
      { timeoutMs: 25_000, message: 'the fleet never settled' }
    )

    const agents = app.ctx.agents.list(project.id)
    const tasks = app.ctx.tasks.list(project.id)
    const evaluations = app.ctx.evaluations.listByProject(project.id)

    // 1. The Orchestrator built a fleet rather than doing the work itself.
    expect(agents.map((a) => a.name).sort()).toEqual([
      'Builder',
      'Docs Writer',
      'Judge',
      'Orchestrator',
      'Reviewer'
    ])

    // 2. Recursion actually happened: a worker created a child of its own.
    const builder = agents.find((a) => a.name === 'Builder')!
    const docsWriter = agents.find((a) => a.name === 'Docs Writer')!
    expect(docsWriter.parentAgentId).toBe(builder.id)
    expect(docsWriter.depth).toBe(builder.depth + 1)
    expect(app.ctx.agents.descendants(builder.id).map((a) => a.name)).toEqual(['Docs Writer'])

    // 3. An agent was used as a tool by another agent.
    const invokes = app.ctx.agents
      .relationships(project.id)
      .filter((r) => r.kind === 'INVOKES')
    expect(invokes).toHaveLength(1)
    expect(invokes[0].fromAgentId).toBe(builder.id)

    // 4. The Judge rejected first, then approved after a revision.
    const decisions = evaluations
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => e.decision)
    expect(decisions).toContain('REJECTED')
    expect(decisions).toContain('APPROVED')
    expect(decisions.indexOf('REJECTED')).toBeLessThan(decisions.lastIndexOf('APPROVED'))

    // 5. A revision task was created and carried the required changes forward.
    const revision = tasks.find((t) => t.revisionOfTaskId != null)
    expect(revision).toBeDefined()
    expect(revision!.title).toMatch(/revision 1/)
    expect(revision!.context.requiredChanges).toEqual([
      'Add greeting.test.js covering the empty-name case'
    ])
    expect(revision!.status).toBe('COMPLETED')
    expect((revision!.score ?? 0) / 100).toBeGreaterThan(0.8)

    // 6. Real side effects landed on disk, not just claims of them.
    const workspace = path.join(app.tmpDir, 'workspaces', project.id)
    expect(existsSync(path.join(workspace, 'src/greeting.js'))).toBe(true)
    expect(existsSync(path.join(workspace, 'src/greeting.test.js'))).toBe(true)
    expect(readFileSync(path.join(workspace, 'src/greeting.js'), 'utf8')).toMatch(/greet/)

    // 7. Nested execution is recorded as nested.
    const executions = app.handle.sqlite
      .prepare('select id, parent_execution_id, depth from task_executions')
      .all() as Array<{ id: string; parent_execution_id: string | null; depth: number }>
    expect(executions.some((e) => e.parent_execution_id != null && e.depth > 0)).toBe(true)

    // 8. The timeline tells the story.
    const eventTypes = new Set(
      (
        app.handle.sqlite.prepare('select type from events').all() as Array<{ type: string }>
      ).map((e) => e.type)
    )
    for (const expected of [
      'PROJECT_CREATED',
      'AGENT_SPAWNED',
      'TASK_CREATED',
      'EXECUTION_STARTED',
      'TOOL_COMPLETED',
      'JUDGE_REJECTED',
      'JUDGE_APPROVED',
      'TASK_COMPLETED'
    ]) {
      expect(eventTypes.has(expected), `expected a ${expected} event`).toBe(true)
    }

    // 9. Cost and usage were accounted for.
    const stats = app.ctx.projects.stats(project.id)
    expect(stats.executions).toBeGreaterThanOrEqual(5)
    expect(stats.inputTokens).toBeGreaterThan(0)
    expect(stats.averageScore).not.toBeNull()
  }, 40_000)
})

describe('project sign-off', () => {
  /** Builds a responder that completes work and returns fixed judge verdicts. */
  function respondWith(projectVerdict: () => string) {
    return async ({ request }: ScriptTurnContext): Promise<ScriptStep[]> => {
      if (request.agentName === 'Judge') {
        const isProject = /# Project under review/.test(request.prompt)
        return [
          {
            type: 'text',
            text: isProject
              ? projectVerdict()
              : verdict({ score: 0.92, decision: 'APPROVED', summary: 'Task is fine.' })
          },
          { type: 'end' }
        ]
      }
      return [
        { type: 'tool', name: 'complete_task', input: { summary: 'Did the work.' } },
        { type: 'end' }
      ]
    }
  }

  it('marks criteria met and completes the project when the Judge signs off', async () => {
    app.scripted.setResponder(
      respondWith(() =>
        JSON.stringify({
          score: 0.94,
          decision: 'APPROVED',
          criteria: [{ name: 'Requirements', score: 0.94, reason: 'All criteria evidenced.' }],
          checklist: [
            { id: 'PC1', text: 'A thing exists', met: true, evidence: 'Observed in the artifacts.' },
            { id: 'PC2', text: 'It is verified', met: true, evidence: 'Test report attached.' }
          ],
          issues: [],
          requiredChanges: [],
          summary: 'The mission is accomplished.'
        })
      )
    )

    const { project } = app.ctx.orchestrator.createFromMission({
      name: 'Sign-off happy path',
      mission: 'Do a thing and verify it.',
      templateId: 'blank',
      autoStart: false,
      settings: { defaultProvider: 'scripted', defaultModel: 'scripted-test' },
      acceptanceCriteria: ['A thing exists', 'It is verified']
    })

    const worker = app.ctx.agents.create({ projectId: project.id, name: 'Worker' })
    const task = app.ctx.tasks.create({
      projectId: project.id,
      agentId: worker.id,
      title: 'Do the thing',
      status: 'READY'
    })

    await waitFor(() => app.ctx.projects.get(project.id).status === 'COMPLETED', {
      timeoutMs: 20_000,
      message: 'the project never reached sign-off'
    })

    expect(app.ctx.tasks.get(task.id).status).toBe('COMPLETED')
    const criteria = app.ctx.projects.get(project.id).acceptanceCriteria
    expect(criteria.every((c) => c.met === true)).toBe(true)
    expect(criteria[0].evidence).toMatch(/artifacts/i)
    expect(app.ctx.projects.stats(project.id).requirementCoverage).toBe(1)
  }, 30_000)

  it('creates a gap-closing task for the Orchestrator instead of completing', async () => {
    app.scripted.setResponder(
      respondWith(() =>
        JSON.stringify({
          score: 0.5,
          decision: 'REJECTED',
          criteria: [{ name: 'Requirements', score: 0.5, reason: 'One criterion is unevidenced.' }],
          checklist: [
            { id: 'PC1', text: 'A thing exists', met: true, evidence: 'Found it.' },
            { id: 'PC2', text: 'It is verified', met: false, evidence: 'No test was ever run.' }
          ],
          issues: ['Nothing verifies the thing'],
          requiredChanges: ['Add a test that actually runs and passes'],
          summary: 'Built, but unverified.'
        })
      )
    )

    const { project } = app.ctx.orchestrator.createFromMission({
      name: 'Sign-off with gaps',
      mission: 'Do a thing and verify it.',
      templateId: 'blank',
      autoStart: false,
      settings: { defaultProvider: 'scripted', defaultModel: 'scripted-test' },
      acceptanceCriteria: ['A thing exists', 'It is verified']
    })

    const worker = app.ctx.agents.create({ projectId: project.id, name: 'Worker' })
    app.ctx.tasks.create({
      projectId: project.id,
      agentId: worker.id,
      title: 'Do the thing',
      status: 'READY'
    })

    await waitFor(
      () => app.ctx.tasks.list(project.id).some((t) => t.context.projectGapFix === true),
      { timeoutMs: 20_000, message: 'no gap-closing task was created' }
    )

    const gapTask = app.ctx.tasks.list(project.id).find((t) => t.context.projectGapFix === true)!
    expect(gapTask.agentId).toBe(app.ctx.agents.orchestratorFor(project.id)?.id)
    expect(gapTask.acceptanceCriteria.map((c) => c.text)).toEqual([
      'Add a test that actually runs and passes'
    ])
    expect(app.ctx.projects.get(project.id).status).not.toBe('COMPLETED')

    const criteria = app.ctx.projects.get(project.id).acceptanceCriteria
    expect(criteria.find((c) => c.id === 'PC1')?.met).toBe(true)
    expect(criteria.find((c) => c.id === 'PC2')?.met).toBe(false)
  }, 30_000)
})

describe('recursion safety', () => {
  it('refuses to spawn past the depth limit and says so usefully', async () => {
    app.scripted.setResponder(async ({ request, turn }): Promise<ScriptStep[]> => {
      if (request.agentName === 'Judge') {
        return [
          { type: 'text', text: verdict({ score: 0.9, decision: 'APPROVED', summary: 'ok' }) },
          { type: 'end' }
        ]
      }
      if (turn === 1) {
        return [
          {
            type: 'tool',
            name: 'create_agent',
            input: {
              name: 'Too Deep',
              description: 'should not exist',
              system_prompt: 'x'
            }
          }
        ]
      }
      const denial = String(request.prompt).length > 0
      return [
        {
          type: 'tool',
          name: 'complete_task',
          input: { summary: denial ? 'Could not spawn; did it myself.' : 'done' }
        },
        { type: 'end' }
      ]
    })

    const project = app.ctx.projects.create({
      name: 'Depth test',
      settings: {
        defaultProvider: 'scripted',
        autoJudge: false,
        limits: { maxDepth: 0 }
      }
    })
    const orchestrator = app.ctx.agents.orchestratorFor(project.id)!
    app.ctx.agents.grant(orchestrator.id, ['AGENT_CREATE'])

    const task = app.ctx.tasks.create({
      projectId: project.id,
      agentId: orchestrator.id,
      title: 'Try to spawn',
      requiresJudge: false,
      status: 'READY'
    })

    await waitFor(() => app.ctx.tasks.get(task.id).status === 'COMPLETED', { timeoutMs: 15_000 })

    // No child was created, and the refusal was recorded rather than crashing.
    expect(app.ctx.agents.list(project.id).map((a) => a.name).sort()).toEqual([
      'Judge',
      'Orchestrator'
    ])
    const denials = app.handle.sqlite
      .prepare("select message from events where type = 'TOOL_COMPLETED' or type = 'TOOL_FAILED'")
      .all() as Array<{ message: string }>
    expect(denials.some((d) => /create_agent/.test(d.message))).toBe(true)
  }, 30_000)

  it('denies a tool the agent has no permission for', async () => {
    const project = app.ctx.projects.create({
      name: 'Permission test',
      settings: { defaultProvider: 'scripted', autoJudge: false }
    })
    const agent = app.ctx.agents.create({
      projectId: project.id,
      name: 'Reader',
      permissions: ['FILES_READ'],
      toolkitNames: ['Filesystem']
    })

    let denial = ''
    app.scripted.setResponder(async ({ turn, lastResults }): Promise<ScriptStep[]> => {
      if (turn === 1) {
        return [
          {
            type: 'tool',
            name: 'write_file',
            input: { path: 'nope.txt', content: 'should not be written' }
          }
        ]
      }
      denial = lastResults[0]?.content ?? ''
      return [
        { type: 'tool', name: 'complete_task', input: { summary: 'blocked by permissions' } },
        { type: 'end' }
      ]
    })

    // Approval is required for the missing permission; deny it immediately.
    app.ctx.bus.on('APPROVAL_REQUESTED', (event) => {
      app.ctx.approvals.resolve(String(event.data.approvalId), false, 'Not for this agent.')
    })

    const task = app.ctx.tasks.create({
      projectId: project.id,
      agentId: agent.id,
      title: 'Attempt a write',
      requiresJudge: false,
      status: 'READY'
    })

    await waitFor(() => app.ctx.tasks.get(task.id).status === 'COMPLETED', { timeoutMs: 15_000 })
    expect(denial).toMatch(/Permission denied/i)
    expect(denial).toMatch(/FILES_WRITE/)
    expect(existsSync(path.join(app.tmpDir, 'workspaces', project.id, 'nope.txt'))).toBe(false)
  }, 30_000)
})
