/**
 * Captures the screenshot set used by the README.
 *
 * Same principle as workbench-check.mjs - the real application, the real
 * database, no mock frames - but it walks through each surface for the picture
 * rather than asserting, and renders at 2x so the images stay sharp.
 *
 *   xvfb-run -a -s "-screen 0 3400x2200x24" node scripts/product-shots.mjs
 */
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { _electron: electron } = require(process.env.AO_PLAYWRIGHT ?? 'playwright')

const userData = process.env.AO_USER_DATA ?? path.resolve('.demo-userdata')
const outDir = process.env.AO_SHOTS ?? path.resolve('screenshots')
mkdirSync(outDir, { recursive: true })

const captured = []
const skipped = []

const app = await electron.launch({
  executablePath: require('electron'),
  timeout: 120_000,
  args: [
    '.',
    `--user-data-dir=${userData}`,
    '--no-sandbox',
    '--disable-gpu',
    // Retina density. Chromium has to be told at launch, and calling
    // setViewportSize afterwards would reset it to 1.
    '--force-device-scale-factor=2',
    '--high-dpi-support=1'
  ],
  env: { ...process.env, NODE_ENV: 'production' }
})

const window = await app.firstWindow()
await window.waitForSelector('text=Agent Orchestrator', { timeout: 30_000 })
await window.waitForTimeout(3500)

const projects = window.locator('[data-pane="projects"]')
const doc = window.locator('[data-pane="document"]')
const sessions = window.locator('[data-pane="sessions"]')
const terminal = window.locator('[data-pane="terminal"]')

async function shot(name) {
  await window.screenshot({ path: path.join(outDir, `${name}.png`), scale: 'device' })
  captured.push(name)
  console.log(`  captured ${name}`)
}

/** Best effort: a missing element costs one image, not the run. */
async function click(locator, waitMs = 1200) {
  try {
    await locator.click({ timeout: 6000 })
    await window.waitForTimeout(waitMs)
    return true
  } catch {
    skipped.push(await locator.evaluate((el) => el.textContent ?? '?').catch(() => '?'))
    return false
  }
}

/**
 * Opens a project section from the left rail. Scoped to the indented section
 * rows, because a plain text match on "Report" also hits the project row
 * "Weekly telemetry report" above it.
 */
const section = (label) => projects.locator('button.pl-8').filter({ hasText: label }).first()

console.log('\nCapturing')

await shot('workbench')

await click(sessions.getByText('Data Engineer').first(), 2000)
await shot('agent-document')

await click(sessions.getByText('Usage').first(), 1200)
await shot('usage')
await click(sessions.getByText('Sessions').first(), 800)

// The floor needs a moment: the canvas animates in, and a shot taken too early
// catches robots mid-walk to their desks.
await click(section('Floor'), 3500)
await shot('floor')

await click(section('Graph'), 2000)
await shot('graph')

await click(section('Tasks'), 1500)
await click(doc.getByText('Ingest and normalise the weekly export').first(), 1200)
await click(doc.getByText('Verdicts').first(), 1200)
await shot('verdict')

await click(section('Workflows'), 1800)
await click(doc.getByText('Weekly refresh').first(), 1800)
await shot('workflows')

await click(doc.getByText('Pipeline smoke test').first(), 1500)
await click(doc.locator('button:has-text("Runs")').first(), 1400)
await click(doc.locator('button:has-text("COMPLETED")').first(), 1400)
await shot('workflow-runs')

await click(section('Workspace'), 1800)
try {
  await doc.locator('select').first().selectOption({ label: "Data Engineer's worktree" })
  await window.waitForTimeout(1500)
} catch {
  skipped.push('worktree selector')
}
await click(doc.getByText('Changes', { exact: false }).first(), 1500)
await click(doc.getByText('src/ingest.ts').first(), 1200)
await shot('workspace-changes')

await click(doc.getByText('Worktrees').first(), 1200)
await shot('worktrees')

// The Release toolkit, mid-run. The licence is cleared first so the dialog shows
// the write rather than the (correct) refusal to overwrite.
await click(sessions.getByText('Git Master').first(), 1800)
try {
  rmSync(path.join(userData, 'repo', 'LICENSE'), { force: true })
  const toolkit = window.locator('[data-pane="toolkit"]')
  await toolkit.locator('button').filter({ hasText: 'create_license' }).first().click()
  await window.waitForTimeout(900)
  await window.locator('div.fixed [data-arg="kind"]').selectOption('mit')
  await window.locator('div.fixed [data-arg="holder"]').fill('Weekly Telemetry Ltd')
  await window.locator('div.fixed button:has-text("Run")').click()
  await window.waitForTimeout(2500)
  await shot('release-toolkit')
  await window.locator('div.fixed button:has-text("Close")').click()
  await window.waitForTimeout(600)
} catch {
  skipped.push('release toolkit')
}

await click(section('Automation'), 1500)
await shot('automation')

await click(section('Memory'), 1500)
await shot('memory')

await click(section('Settings'), 1500)
await shot('settings')

try {
  await doc.getByText('From address').first().scrollIntoViewIfNeeded()
  await window.waitForTimeout(600)
  await shot('email-settings')
} catch {
  skipped.push('email settings')
}

// The terminal doing something, rather than sitting empty.
await click(section('Report'), 1500)
try {
  await terminal.locator('input[placeholder="npm test"]').fill('git log --oneline -5 && ls -1')
  await terminal.locator('button:has-text("Run")').click()
  await window.waitForTimeout(3500)
} catch {
  skipped.push('terminal')
}
await shot('terminal')

// Command palette, opened by its header button - the keyboard shortcut needs a
// focused window, which xvfb will not give us.
await click(window.locator('button:has-text("⌘K")').first(), 800)
await window.keyboard.type('age', { delay: 60 }).catch(() => undefined)
await window.waitForTimeout(800)
await shot('palette')

console.log(`\n${captured.length} images in ${outDir}`)
if (skipped.length) console.log(`could not reach: ${skipped.length} target(s)`)

await app.close()
