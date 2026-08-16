/**
 * Drives the workbench shell through its own interface.
 *
 * The three columns are wired to different parts of the system - the rail reads
 * the whole fleet, the centre reads one project, the toolkit reads one agent -
 * so the thing worth asserting is that clicking in one column changes the right
 * thing in the others.
 *
 *   xvfb-run -a node scripts/workbench-check.mjs
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
await window.setViewportSize({ width: 1680, height: 1000 })

const consoleErrors = []
window.on('pageerror', (err) => consoleErrors.push(String(err)))
window.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

await window.waitForSelector('text=Agent Orchestrator', { timeout: 30_000 })
await window.waitForTimeout(3000)

// Agent names appear in every column at once, so each assertion says which pane
// it is talking about. A bare `text=` selector here silently matches the report.
const projects = window.locator('[data-pane="projects"]')
const doc = window.locator('[data-pane="document"]')
const sessions = window.locator('[data-pane="sessions"]')
const toolkit = window.locator('[data-pane="toolkit"]')
const terminal = window.locator('[data-pane="terminal"]')
const chat = window.locator('[data-pane="chat"]')
const tabs = window.locator('[data-pane="tabs"]')

console.log('\nThe three columns are populated')
check('project tree lists the project', await projects.getByText('Weekly telemetry report').first().isVisible())
check('sessions rail lists the fleet', await sessions.getByText('Schema Designer').first().isVisible())
check(
  'the rail draws an avatar per agent',
  (await sessions.locator('svg[aria-label="Agent avatar"]').count()) >= 6
)
check('the report opened by default', await doc.getByText('Acceptance criteria').first().isVisible())
check('the terminal is docked', await terminal.getByText('TERMINAL').first().isVisible())

console.log('\nThe report is generated from real state')
check('progress segments are labelled', await doc.getByText('Completed').first().isVisible())
check('the score chart drew its threshold', (await doc.locator('text=/pass \\d+%/').count()) > 0)
check(
  'criteria are listed',
  await doc.getByText('The raw export is normalised without silent data loss').first().isVisible()
)

console.log('\nClicking an agent in the rail opens its document and fills the toolkit')
await sessions.getByText('Data Engineer').first().click()
await window.waitForTimeout(2000)
check('the agent document opened', await doc.getByText('What it is for').first().isVisible())
check('its skills are shown', await doc.getByText('Skills').first().isVisible())
check('its place in the fleet is shown', await doc.getByText('Place in the fleet').first().isVisible())
check(
  'the toolkit panel bound to that agent',
  await toolkit.getByText('Data Engineer').first().isVisible()
)
const toolCount = await toolkit.locator('span.font-mono').count()
check('the toolkit lists tools', toolCount > 0, String(toolCount))
await window.screenshot({ path: path.join(outDir, 'workbench-agent.png') })

console.log('\nProject sections open as tabs in the centre')
await projects.getByText('Graph').first().click()
await window.waitForTimeout(1800)
check('the graph opened', await doc.getByText('DELEGATES').first().isVisible())
const tabCount = await tabs.locator('div.group').count()
check('three documents are open', tabCount >= 3, `${tabCount} tabs`)

console.log('\nThe terminal runs a command in the workspace')
await terminal.locator('input[placeholder="npm test"]').fill('echo workbench-ok')
await terminal.locator('button:has-text("Run")').click()
await window.waitForTimeout(3500)
check('the command echoed back', (await terminal.getByText('workbench-ok').count()) > 0)
check('the exit code was reported', (await terminal.getByText('[exit 0]').count()) > 0)
await window.screenshot({ path: path.join(outDir, 'workbench-terminal.png') })

console.log('\nThe fleet chat accepts a message from the human')
const note = `Check the malformed-header case ${Date.now()}`
await chat.locator('input[placeholder="Message the fleet…"]').fill(note)
await chat.locator('input[placeholder="Message the fleet…"]').press('Enter')
await window.waitForTimeout(2000)
check('the message reached the thread', (await chat.getByText(note).count()) > 0)

console.log('\nClosing a tab leaves the others alone')
const before = await tabs.locator('div.group').count()
await tabs.locator('div.group', { hasText: 'Graph' }).first().hover()
await tabs.locator('div.group', { hasText: 'Graph' }).first().locator('button[title="Close"]').click()
await window.waitForTimeout(1200)
check('one fewer tab', (await tabs.locator('div.group').count()) === before - 1)
check('the graph is no longer rendered', (await doc.getByText('DELEGATES').count()) === 0)
check('a document is still open', (await doc.locator('*').count()) > 0)

console.log('')
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await app.close()

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll workbench checks passed.')
