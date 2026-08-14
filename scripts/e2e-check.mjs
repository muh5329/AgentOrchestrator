/**
 * Drives the real application through its own UI.
 *
 * The unit and integration suites call the engine directly; this proves the
 * whole chain a person actually uses - click, IPC, engine, live events, render -
 * by running a workflow from the interface and asserting the run it produced.
 *
 *   xvfb-run -a node scripts/e2e-check.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { _electron: electron } = require(process.env.AO_PLAYWRIGHT ?? 'playwright')

const userData = process.env.AO_USER_DATA ?? path.resolve('.demo-userdata')
const outDir = path.resolve('.shots')
mkdirSync(outDir, { recursive: true })

const failures = []
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label} ${detail}`)
    failures.push(label)
  }
}

const app = await electron.launch({
  executablePath: require('electron'),
  timeout: 120_000,
  args: ['.', `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, NODE_ENV: 'production' }
})

const window = await app.firstWindow()
await window.setViewportSize({ width: 1560, height: 980 })

const consoleErrors = []
window.on('pageerror', (err) => consoleErrors.push(String(err)))
window.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

await window.waitForSelector('text=Agent Orchestrator', { timeout: 30_000 })
await window.waitForTimeout(2500)

console.log('\nProject loads from disk')
check('project name is shown', await window.isVisible('text=Weekly telemetry report'))
check('fleet is listed', await window.isVisible('text=Data Engineer'))

console.log('\nRunning a workflow from the interface')
await window.click('nav >> text=Workflows')
await window.waitForTimeout(1000)
await window.click('text=Pipeline smoke test')
await window.waitForTimeout(1200)
check('graph rendered', await window.isVisible('text=Probe raw feed'))

// Exact text: `has-text("Run")` also matches the "Runs 0" tab, which renders
// first, so a substring match clicks the wrong control and silently does nothing.
const runButton = window.locator('button:text-is("Run")')
check('the Run button is enabled', await runButton.isEnabled())
await runButton.click()
await window.waitForTimeout(4000)
await window.screenshot({ path: path.join(outDir, 'e2e-workflow-run.png') })

// Read the result back out of the app the same way the UI does.
const runs = await window.evaluate(async () => {
  const projects = await window.ao.invoke('projects.list')
  const project = projects.find((p) => p.name === 'Weekly telemetry report')
  const workflows = await window.ao.invoke('workflows.list', { projectId: project.id })
  const workflow = workflows.find((w) => w.name === 'Pipeline smoke test')
  const list = await window.ao.invoke('workflows.runs', {
    projectId: project.id,
    workflowId: workflow.id
  })
  const nodeRuns = list.length
    ? await window.ao.invoke('workflows.nodeRuns', { runId: list[0].id })
    : []
  return { run: list[0] ?? null, nodeRuns }
})

check('a run was recorded', Boolean(runs.run), JSON.stringify(runs.run))
check('the run completed', runs.run?.status === 'COMPLETED', runs.run?.error ?? '')
check('every step succeeded', runs.nodeRuns.every((n) => n.status === 'COMPLETED'))
check(
  'both parallel branches ran',
  runs.nodeRuns.some((n) => n.label === 'Probe raw feed') &&
    runs.nodeRuns.some((n) => n.label === 'Probe clean feed')
)
check(
  'the condition took its true branch',
  runs.nodeRuns.some((n) => n.label === 'Record healthy') &&
    !runs.nodeRuns.some((n) => n.label === 'Raise alert')
)

console.log('\nRun history renders')
await window.click('button:has-text("Runs")')
await window.waitForTimeout(1200)
// Look for the step list of the run, not a bare "COMPLETED" - the project badge
// in the title bar says COMPLETED too, which made this pass without a run.
check('the step list is shown', await window.isVisible('text=Probe clean feed'))
check('the final context is shown', await window.isVisible('text=withinBudget'))
await window.screenshot({ path: path.join(outDir, 'e2e-workflow-history.png') })

console.log('\nWorkspace reads the repository')
await window.click('nav >> text=Workspace')
await window.waitForTimeout(1500)
check('file tree lists the repo', await window.isVisible('text=README.md'))
await window.click('text=Worktrees')
await window.waitForTimeout(1000)
check('agent worktrees are listed', await window.isVisible('text=ao/data-engineer'))

console.log('\nTask board and judge verdicts')
await window.click('nav >> text=Tasks')
await window.waitForTimeout(1200)
check('a completed task is on the board', await window.isVisible('text=Write the weekly summary'))

console.log('')
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await app.close()

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll UI checks passed.')
