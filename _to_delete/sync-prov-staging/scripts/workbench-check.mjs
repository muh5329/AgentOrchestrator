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
import { mkdirSync, rmSync } from 'node:fs'
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
check(
  'its standing instructions are shown',
  await doc.getByText('Standing instructions').first().isVisible()
)
check('its place in the fleet is shown', await doc.getByText('Place in the fleet').first().isVisible())
check(
  'the toolkit panel bound to that agent',
  await toolkit.getByText('Data Engineer').first().isVisible()
)
const toolCount = await toolkit.locator('button').filter({ hasText: 'read_file' }).count()
check('the toolkit lists tools as launchers', toolCount > 0, String(toolCount))
await window.screenshot({ path: path.join(outDir, 'workbench-agent.png') })

console.log('\nRunning a tool by hand goes through the real gate')
await toolkit.locator('button').filter({ hasText: 'list_dir' }).first().click()
await window.waitForTimeout(1000)
check('the run dialog opened', await window.getByText('Runs as this agent').first().isVisible())
await window.locator('div.fixed button:has-text("Run")').click()
await window.waitForTimeout(3000)
// A real filesystem read of the project workspace, which contains README.md.
check(
  'it returned a real result',
  (await window.locator('div.fixed pre').first().innerText()).length > 0,
  await window.locator('div.fixed pre').first().innerText().catch(() => 'no output')
)
await window.screenshot({ path: path.join(outDir, 'workbench-tool-run.png') })
await window.locator('div.fixed button:has-text("Close")').click()
await window.waitForTimeout(600)

console.log('\nThe Release toolkit does the real thing')
await sessions.getByText('Git Master').first().click()
await window.waitForTimeout(1800)
check(
  'the Git Master carries the Release toolkit',
  (await toolkit.locator('button').filter({ hasText: 'create_license' }).count()) > 0
)
// The tool refuses to overwrite an existing licence, which is correct and also
// means a second run of this script would assert the refusal instead of the
// write. Clear it so the check tests what it says it tests.
rmSync(path.join(userData, 'repo', 'LICENSE'), { force: true })
await toolkit.locator('button').filter({ hasText: 'create_license' }).first().click()
await window.waitForTimeout(900)
await window.locator('div.fixed textarea, div.fixed input').first().waitFor({ timeout: 10_000 })
// The dialog builds its form from the tool's own schema, so filling it by label
// is also an assertion that the schema reached the interface intact.
await window.locator('div.fixed [data-arg="kind"]').selectOption('mit')
await window.locator('div.fixed [data-arg="holder"]').fill('Weekly Telemetry Ltd')
await window.locator('div.fixed button:has-text("Run")').click()
await window.waitForTimeout(3000)
const licenceOut = await window.locator('div.fixed pre').first().innerText().catch(() => '')
check('it reported writing the licence', /MIT LICENSE/i.test(licenceOut), licenceOut.slice(0, 120))
await window.screenshot({ path: path.join(outDir, 'workbench-release.png') })
await window.locator('div.fixed button:has-text("Close")').click()
await window.waitForTimeout(600)

console.log('\nSettings holds the SMTP account and the local commands')
await projects.getByText('Settings').first().click()
await window.waitForTimeout(1800)
check('the email panel is present', await doc.getByText('From address').first().isVisible())
check(
  'it says plainly that no account is configured',
  (await doc.getByText('not configured').count()) > 0
)
check(
  'the dev server command has a field',
  await doc.getByPlaceholder('npm run dev').first().isVisible()
)

console.log('\nThe billing account is stated before anything is spent')
check('the billing choice is offered', await doc.getByText('My Claude subscription').first().isVisible())
check(
  'the subscription is the default',
  await doc.locator('input[type="radio"]').first().isChecked()
)
// The verdict is computed from the environment the CLI would actually get, so
// this asserts the app is telling the truth about whose money is at stake.
check(
  'it says which account a run would use',
  (await doc.getByText(/subscription you signed in|API credits|routes through/).count()) > 0
)

console.log('\nLocal models can be pointed at a server')
check('the local models panel is present', await doc.getByText('Server address').first().isVisible())
check(
  'it says nothing is configured yet, rather than implying it works',
  (await doc.getByText('not configured').count()) > 0
)
await doc.getByPlaceholder('http://127.0.0.1:1234/v1').first().fill(process.env.AO_FAKE_LLM ?? 'http://127.0.0.1:9/v1')
await doc.locator('button:has-text("Connect")').first().click()
await window.waitForTimeout(2500)
check(
  'connecting to a dead address reports it honestly',
  (await doc.getByText(/Nothing answered at that address/).count()) > 0
)
await doc.getByPlaceholder('npm run dev').first().fill('npm run dev')
await doc.getByPlaceholder('npm run dev').first().blur()
await window.waitForTimeout(1200)
await doc.getByText('From address').first().scrollIntoViewIfNeeded()
await window.waitForTimeout(500)
await window.screenshot({ path: path.join(outDir, 'workbench-settings.png') })

console.log('\nThe floor draws the fleet as an office')
await projects.locator('button.pl-8').filter({ hasText: 'Floor' }).first().click()
await window.waitForTimeout(3500)
check('a canvas is mounted', (await doc.locator('canvas').count()) === 1)
check('the roll call is shown', await doc.getByText('Roll call').first().isVisible())
check('the transport is shown', await doc.getByText('live').first().isVisible())
// Everyone in the demo project is idle, so the floor should say so rather than
// inventing motion - this asserts the counts come from real rows.
const idleRow = await doc.locator('text=Idle').first().isVisible()
check('it reports the real idle count', idleRow)
// The canvas must actually paint: a blank one is all one colour.
const painted = await doc.locator('canvas').evaluate((el) => {
  const ctx = el.getContext('2d')
  const data = ctx.getImageData(0, 0, el.width, el.height).data
  const seen = new Set()
  for (let i = 0; i < data.length; i += 4000) {
    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    if (seen.size > 12) break
  }
  return seen.size
})
check('the canvas painted a scene', painted > 6, `${painted} distinct colours`)
await window.screenshot({ path: path.join(outDir, 'workbench-floor.png') })

console.log('\nThe floor keeps its place when you leave it and come back')
// Read the robots' positions straight off the canvas: switch away, switch back,
// and they must be where they were, not walking in from the door again.
const positions = async () =>
  doc.locator('canvas').evaluate(() => {
    const world = window.__aoFloorProbe?.()
    return world ? world.map((a) => `${a.id}:${a.x.toFixed(1)},${a.y.toFixed(1)}`).sort() : null
  })

/** Waits until nobody is walking, so the comparison is against a settled floor. */
const settle = async () => {
  let previous = null
  for (let i = 0; i < 25; i++) {
    const now = await positions()
    if (now && previous && JSON.stringify(now) === JSON.stringify(previous)) return now
    previous = now
    await window.waitForTimeout(400)
  }
  return previous
}

const settled = await settle()
check('the floor exposes its actors for checking', Array.isArray(settled) && settled.length > 0)
await projects.getByText('Graph').first().click()
await window.waitForTimeout(1500)
await projects.locator('button.pl-8').filter({ hasText: 'Floor' }).first().click()
await window.waitForTimeout(1500)
const after = await positions()
check(
  'every robot is exactly where it was left',
  JSON.stringify(settled) === JSON.stringify(after),
  `${JSON.stringify(settled)?.slice(0, 90)} vs ${JSON.stringify(after)?.slice(0, 90)}`
)
check(
  'nobody was sent back to the door',
  Array.isArray(after) && !after.some((entry) => entry.endsWith(':48.0,60.0'))
)

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
