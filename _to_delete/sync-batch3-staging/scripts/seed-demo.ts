/**
 * Seeds a realistic project into a user-data directory by actually running the
 * orchestration loop with the deterministic provider.
 *
 * Used for visual QA: the resulting database is opened by the real Electron app
 * so screenshots show genuine state rather than mock data.
 *
 *   npx vite-node scripts/seed-demo.ts -- /path/to/userData
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { bootstrap } from '../src/main/core/bootstrap'
import type { ScriptStep, ScriptTurnContext } from '../src/main/runtime/providers/scripted'

const target = process.argv[2] ?? path.resolve('.demo-userdata')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

function verdict(score: number, decision: string, extra: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    score,
    decision,
    criteria: [
      { name: 'Correctness', score, reason: 'Behaviour matches the description.' },
      { name: 'Completeness', score, reason: 'Covers the stated scope.' },
      { name: 'Tests', score: score - 0.05, reason: 'Verification present.' },
      { name: 'Quality', score, reason: 'Readable and consistent.' },
      { name: 'Security', score: 0.95, reason: 'No unsafe handling found.' },
      { name: 'Performance', score: 0.9, reason: 'No obvious inefficiency.' },
      { name: 'Requirements', score, reason: 'Acceptance criteria addressed.' }
    ],
    issues: [],
    requiredChanges: [],
    summary: 'Verified against the acceptance criteria.',
    ...extra
  })
}

/** A real git repository so worktrees and diffs have something to show. */
function makeRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'demo@example.com'])
  git(['config', 'user.name', 'Demo'])
  writeFileSync(path.join(dir, 'README.md'), '# Weekly telemetry\n\nRaw exports land in data/raw.\n')
  mkdirSync(path.join(dir, 'data', 'raw'), { recursive: true })
  writeFileSync(path.join(dir, 'data', 'raw', 'export.csv'), 'at,value\n2026-01-01,41\n,17\n')
  git(['add', '-A'])
  git(['commit', '-m', 'Initial commit'])
  return dir
}

async function main(): Promise<void> {
  const app = bootstrap({
    userData: target,
    migrations: path.resolve('drizzle'),
    enableScriptedProvider: true,
    startEngines: true,
    executor: { tickMs: 20, globalConcurrency: 8 },
    schedulerTickMs: 50,
    watchdogIntervalMs: 60_000
  })
  await app.start()

  const scripted = app.ctx.providers.scripted()!
  const seen = new Map<string, number>()

  scripted.setResponder(async ({ request, turn }: ScriptTurnContext): Promise<ScriptStep[]> => {
    const agent = request.agentName

    if (agent === 'Judge') {
      // Key on the underlying work, not the prompt, so a revision is recognised
      // as a second look at the same task rather than a fresh one.
      const key = /Ingest and normalise/.test(request.prompt) ? 'ingest' : 'other'
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      const rejectFirst = key === 'ingest' && n === 1
      return [
        {
          type: 'text',
          text: rejectFirst
            ? verdict(0.52, 'REJECTED', {
                issues: [
                  'The CSV reader silently drops rows with a missing timestamp',
                  'No test covers a malformed header row'
                ],
                requiredChanges: [
                  'Fail loudly on rows with a missing timestamp instead of skipping them',
                  'Add a test for a malformed header row'
                ],
                summary: 'Works on the happy path, but loses data silently on bad input.'
              })
            : verdict(0.91, 'APPROVED')
        },
        { type: 'end' }
      ]
    }

    if (agent === 'Orchestrator') {
      if (turn === 1) {
        return [
          { type: 'tool', name: 'project_status', input: {} },
          {
            type: 'tool',
            name: 'create_agent',
            input: {
              name: 'Data Engineer',
              description: 'Owns ingestion and the normalised schema.',
              system_prompt:
                'You own data ingestion. You care about malformed input more than happy paths. Nothing ships without a test that feeds it garbage.',
              permissions: ['FILES_READ', 'FILES_WRITE', 'AGENT_CREATE', 'AGENT_INVOKE', 'AGENT_MESSAGE', 'MEMORY_WRITE'],
              toolkits: ['Filesystem', 'Knowledge', 'Orchestration']
            }
          },
          {
            type: 'tool',
            name: 'create_agent',
            input: {
              name: 'Analyst',
              description: 'Turns the normalised data into the weekly summary.',
              system_prompt:
                'You produce the weekly summary from normalised data. State uncertainty plainly; never round a number you did not compute.',
              permissions: ['FILES_READ', 'FILES_WRITE', 'AGENT_MESSAGE', 'MEMORY_WRITE'],
              toolkits: ['Filesystem', 'Knowledge']
            }
          },
          {
            type: 'tool',
            name: 'create_agent',
            input: {
              name: 'Reviewer',
              description: 'Second pair of eyes on every deliverable.',
              system_prompt: 'You review work for defects and report them concretely.',
              permissions: ['FILES_READ', 'AGENT_MESSAGE'],
              toolkits: ['Inspection', 'Knowledge']
            }
          },
          {
            type: 'tool',
            name: 'create_agent',
            input: {
              name: 'Git Master',
              role: 'gitmaster',
              description: 'Owns the repository: branches, commits, merges, releases.',
              system_prompt:
                'You are the Git Master. Commit messages say why, not what. Never merge a branch whose work was not judged.',
              permissions: ['FILES_READ', 'FILES_WRITE', 'GIT_WRITE', 'SHELL_EXECUTE', 'AGENT_MESSAGE'],
              toolkits: ['Git', 'Release', 'Filesystem', 'Inspection']
            }
          },
          {
            type: 'tool',
            name: 'remember',
            input: {
              content:
                'Raw exports land in data/raw and must never be edited in place; normalised output goes to data/clean.',
              kind: 'constraint',
              key: 'data-layout',
              importance: 85,
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
              agent: 'Data Engineer',
              title: 'Ingest and normalise the weekly export',
              description:
                'Read data/raw/export.csv, normalise it into data/clean/weekly.json, and cover malformed input with tests.',
              acceptance_criteria: [
                'data/clean/weekly.json is produced from the raw export',
                'Rows with a missing timestamp cause a loud failure, not a silent skip',
                'A test covers a malformed header row'
              ],
              priority: 80
            }
          },
          {
            type: 'tool',
            name: 'delegate_task',
            input: {
              agent: 'Analyst',
              title: 'Write the weekly summary',
              description: 'Summarise data/clean/weekly.json into reports/weekly.md.',
              acceptance_criteria: [
                'reports/weekly.md exists and cites the numbers it uses',
                'Any gap in the data is stated explicitly'
              ],
              priority: 60
            }
          },
          {
            type: 'tool',
            name: 'create_schedule',
            input: {
              kind: 'cron',
              cron: '0 9 * * 1',
              agent: 'Analyst',
              title: 'Weekly summary refresh',
              description: 'Regenerate reports/weekly.md from the latest clean data.',
              acceptance_criteria: ['The report reflects the most recent export']
            }
          }
        ]
      }
      return [
        {
          type: 'tool',
          name: 'complete_task',
          input: {
            summary:
              'Staffed a Data Engineer, an Analyst and a Reviewer; delegated ingestion and reporting, and scheduled the weekly refresh.'
          }
        },
        { type: 'end' }
      ]
    }

    if (agent === 'Data Engineer') {
      const revision = /Revision \(attempt/.test(request.prompt)
      if (revision) {
        return [
          {
            type: 'tool',
            name: 'write_file',
            input: {
              path: 'src/ingest.ts',
              content:
                "export function ingest(rows: string[][]): Row[] {\n  return rows.map((row, i) => {\n    if (!row[0]) throw new Error(`row ${i}: missing timestamp`)\n    return { at: row[0], value: Number(row[1]) }\n  })\n}\n"
            }
          },
          {
            type: 'tool',
            name: 'write_file',
            input: {
              path: 'src/ingest.test.ts',
              content:
                "test('malformed header', () => { expect(() => ingest([[''],['a']])).toThrow(/missing timestamp/) })\n"
            }
          },
          {
            type: 'tool',
            name: 'complete_task',
            input: {
              summary:
                'Ingestion now throws on a missing timestamp and a test covers the malformed header case.',
              artifacts: ['src/ingest.ts', 'src/ingest.test.ts']
            }
          },
          { type: 'end' }
        ]
      }
      if (turn === 1) {
        return [
          {
            type: 'tool',
            name: 'create_agent',
            input: {
              name: 'Schema Designer',
              description: 'Defines the normalised schema the pipeline targets.',
              system_prompt: 'You design minimal, explicit schemas and document every field.',
              permissions: ['FILES_READ', 'FILES_WRITE'],
              toolkits: ['Filesystem']
            }
          },
          {
            type: 'tool',
            name: 'invoke_agent',
            input: {
              agent: 'Schema Designer',
              task: 'Define the normalised weekly record schema',
              acceptance_criteria: ['Every field has a type and a description']
            }
          },
          {
            type: 'tool',
            name: 'write_file',
            input: {
              path: 'src/ingest.ts',
              content:
                'export function ingest(rows: string[][]): Row[] {\n  return rows.filter((r) => r[0]).map((r) => ({ at: r[0], value: Number(r[1]) }))\n}\n'
            }
          },
          {
            type: 'tool',
            name: 'complete_task',
            input: {
              summary: 'Wrote the ingestion pass against the schema the Schema Designer produced.',
              artifacts: ['src/ingest.ts']
            }
          },
          { type: 'end' }
        ]
      }
    }

    if (agent === 'Schema Designer') {
      return [
        {
          type: 'tool',
          name: 'write_file',
          input: {
            path: 'docs/schema.md',
            content: '# Weekly record\n\n- `at` (ISO timestamp) — when the reading was taken\n- `value` (number) — the reading\n'
          }
        },
        {
          type: 'tool',
          name: 'complete_task',
          input: { summary: 'Documented the two-field weekly record schema.', artifacts: ['docs/schema.md'] }
        },
        { type: 'end' }
      ]
    }

    if (agent === 'Analyst') {
      return [
        { type: 'tool', name: 'recall', input: { query: 'data layout' } },
        {
          type: 'tool',
          name: 'write_file',
          input: {
            path: 'reports/weekly.md',
            content: '# Weekly summary\n\n12 readings, mean 41.2. Two days are missing from the export.\n'
          }
        },
        {
          type: 'tool',
          name: 'send_message',
          input: { agent: 'Reviewer', content: 'reports/weekly.md is ready for review.' }
        },
        {
          type: 'tool',
          name: 'complete_task',
          input: {
            summary: 'Wrote reports/weekly.md and flagged the two missing days.',
            artifacts: ['reports/weekly.md']
          }
        },
        { type: 'end' }
      ]
    }

    return [
      { type: 'tool', name: 'complete_task', input: { summary: 'Nothing to do.' } },
      { type: 'end' }
    ]
  })

  const repo = makeRepo(path.join(target, 'repo'))

  const { project } = app.ctx.orchestrator.createFromMission({
    name: 'Weekly telemetry report',
    rootPath: repo,
    mission:
      'Turn the raw weekly export into a normalised dataset and a summary our team can read on Monday morning.',
    templateId: 'software',
    settings: {
      defaultProvider: 'scripted',
      defaultModel: 'scripted-demo',
      isolateAgentWorkspaces: true
    },
    acceptanceCriteria: [
      'The raw export is normalised without silent data loss',
      'A readable weekly summary is produced',
      'The pipeline runs again next week without manual steps'
    ]
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const tasks = app.ctx.tasks.list(project.id)
    const settled =
      tasks.length >= 4 &&
      tasks.every((t) => ['COMPLETED', 'CANCELLED', 'FAILED'].includes(t.status)) &&
      app.ctx.executor.activeCount === 0
    if (settled) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  // A pending approval so the approvals surface has something real in it.
  app.ctx.approvals.request({
    projectId: project.id,
    agentId: app.ctx.agents.findByName(project.id, 'Data Engineer')?.id ?? null,
    action: 'run_shell(npm publish --access public)',
    reason: 'Publishing to the public registry is irreversible, so this project gates it.'
  })

  // A workflow so the builder has something real to show.
  const workflow = app.ctx.workflows.create({
    projectId: project.id,
    name: 'Weekly refresh',
    description: 'Regenerate the report, judge it, and ask before publishing.',
    trigger: 'manual'
  })
  const node = (key: string) => `wfn_demo_${key}`
  app.ctx.workflows.saveGraph({
    workflowId: workflow.id,
    nodes: [
      { id: node('start'), kind: 'start', label: 'Start', config: {}, x: 340, y: 40 },
      {
        id: node('ingest'),
        kind: 'agent',
        label: 'Re-ingest export',
        config: {
          agent: 'Data Engineer',
          task: 'Re-run ingestion over data/raw/export.csv',
          saveAs: 'ingest'
        },
        x: 340,
        y: 150
      },
      {
        id: node('check'),
        kind: 'condition',
        label: 'Ingestion clean?',
        config: { expression: "vars.ingest && vars.ingest.status === 'completed'" },
        x: 340,
        y: 265
      },
      {
        id: node('report'),
        kind: 'agent',
        label: 'Write summary',
        config: { agent: 'Analyst', task: 'Regenerate reports/weekly.md', saveAs: 'report' },
        x: 140,
        y: 385
      },
      {
        id: node('judge'),
        kind: 'judge',
        label: 'Judge the summary',
        config: { saveAs: 'verdict' },
        x: 140,
        y: 500
      },
      {
        id: node('approve'),
        kind: 'approval',
        label: 'Publish?',
        config: { action: 'Publish the weekly report', reason: 'Goes out to the whole team.' },
        x: 140,
        y: 615
      },
      { id: node('escalate'), kind: 'delay', label: 'Hold for a human', config: { ms: 1000 }, x: 560, y: 385 },
      { id: node('end'), kind: 'end', label: 'End', config: {}, x: 340, y: 730 }
    ],
    edges: [
      { id: 'wfe_demo_1', fromNodeId: node('start'), toNodeId: node('ingest') },
      { id: 'wfe_demo_2', fromNodeId: node('ingest'), toNodeId: node('check') },
      { id: 'wfe_demo_3', fromNodeId: node('check'), toNodeId: node('report'), label: 'true' },
      { id: 'wfe_demo_4', fromNodeId: node('check'), toNodeId: node('escalate'), label: 'false' },
      { id: 'wfe_demo_5', fromNodeId: node('report'), toNodeId: node('judge') },
      { id: 'wfe_demo_6', fromNodeId: node('judge'), toNodeId: node('approve') },
      { id: 'wfe_demo_7', fromNodeId: node('approve'), toNodeId: node('end'), label: 'approved' },
      { id: 'wfe_demo_8', fromNodeId: node('approve'), toNodeId: node('escalate'), label: 'denied' },
      { id: 'wfe_demo_9', fromNodeId: node('escalate'), toNodeId: node('end') }
    ]
  })

  // A purely mechanical workflow, so a live UI run needs no model at all.
  const smoke = app.ctx.workflows.create({
    projectId: project.id,
    name: 'Pipeline smoke test',
    description: 'Mechanical steps only - proves the engine end to end without a provider.',
    trigger: 'manual'
  })
  const s = (key: string): string => `wfn_smoke_${key}`
  app.ctx.workflows.saveGraph({
    workflowId: smoke.id,
    nodes: [
      { id: s('start'), kind: 'start', label: 'Start', config: {}, x: 300, y: 40 },
      { id: s('fork'), kind: 'parallel', label: 'Check both feeds', config: {}, x: 300, y: 150 },
      { id: s('a'), kind: 'delay', label: 'Probe raw feed', config: { ms: 120 }, x: 120, y: 260 },
      { id: s('b'), kind: 'delay', label: 'Probe clean feed', config: { ms: 120 }, x: 480, y: 260 },
      { id: s('join'), kind: 'merge', label: 'Both done', config: {}, x: 300, y: 370 },
      {
        id: s('check'),
        kind: 'condition',
        label: 'Within budget?',
        config: { expression: 'true', saveAs: 'withinBudget' },
        x: 300,
        y: 480
      },
      { id: s('ok'), kind: 'delay', label: 'Record healthy', config: { ms: 60 }, x: 120, y: 590 },
      { id: s('alert'), kind: 'delay', label: 'Raise alert', config: { ms: 60 }, x: 480, y: 590 },
      { id: s('end'), kind: 'end', label: 'End', config: {}, x: 300, y: 700 }
    ],
    edges: [
      { id: 'wfe_smoke_1', fromNodeId: s('start'), toNodeId: s('fork') },
      { id: 'wfe_smoke_2', fromNodeId: s('fork'), toNodeId: s('a') },
      { id: 'wfe_smoke_3', fromNodeId: s('fork'), toNodeId: s('b') },
      { id: 'wfe_smoke_4', fromNodeId: s('a'), toNodeId: s('join') },
      { id: 'wfe_smoke_5', fromNodeId: s('b'), toNodeId: s('join') },
      { id: 'wfe_smoke_6', fromNodeId: s('join'), toNodeId: s('check') },
      { id: 'wfe_smoke_7', fromNodeId: s('check'), toNodeId: s('ok'), label: 'true' },
      { id: 'wfe_smoke_8', fromNodeId: s('check'), toNodeId: s('alert'), label: 'false' },
      { id: 'wfe_smoke_9', fromNodeId: s('ok'), toNodeId: s('end') },
      { id: 'wfe_smoke_10', fromNodeId: s('alert'), toNodeId: s('end') }
    ]
  })

  const stats = app.ctx.projects.stats(project.id)
  console.log(
    `seeded ${target}: ${stats.agents} agents, ${stats.tasksTotal} tasks, ` +
      `${app.ctx.evaluations.listByProject(project.id).length} verdicts, ` +
      `${app.ctx.workflows.list(project.id).length} workflow, repo at ${repo}`
  )

  await app.close()
}

void main()
