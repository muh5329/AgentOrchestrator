/**
 * Launches the real Electron application against a seeded database and captures
 * screenshots of each surface, so the UI can be inspected rather than assumed.
 *
 *   xvfb-run -a node scripts/visual-check.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// Playwright is a developer-machine tool, not an app dependency, so it is
// resolved from wherever it happens to be installed.
const require = createRequire(import.meta.url)
const { _electron: electron } = require(process.env.AO_PLAYWRIGHT ?? 'playwright')

const userData = process.env.AO_USER_DATA ?? path.resolve('.demo-userdata')
const outDir = path.resolve('.shots')
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  timeout: 120_000,
  args: ['.', `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, NODE_ENV: 'production' }
})

const window = await app.firstWindow()
await window.setViewportSize({ width: 1560, height: 980 })
await window.waitForSelector('text=Agent Orchestrator', { timeout: 30_000 })
await window.waitForTimeout(2500)

const shots = [
  ['dashboard', null],
  ['agents', 'Agents'],
  ['graph', 'Graph'],
  ['tasks', 'Tasks'],
  ['workflows', 'Workflows'],
  ['workspace', 'Workspace'],
  ['automation', 'Automation'],
  ['memory', 'Memory'],
  ['settings', 'Settings']
]

for (const [name, nav] of shots) {
  if (nav) {
    await window.click(`nav >> text=${nav}`)
    await window.waitForTimeout(900)
  }
  if (name === 'agents') {
    await window.click('text=Data Engineer').catch(() => {})
    await window.waitForTimeout(600)
  }
  if (name === 'tasks') {
    await window.click('text=Ingest and normalise the weekly export').catch(() => {})
    await window.waitForTimeout(600)
  }
  if (name === 'workflows') {
    await window.waitForTimeout(1200)
  }
  if (name === 'workspace') {
    await window.click('text=README.md').catch(() => {})
    await window.waitForTimeout(1200)
    await window.screenshot({ path: path.join(outDir, 'workspace-files.png') })
    await window.click('text=Worktrees').catch(() => {})
    await window.waitForTimeout(900)
  }
  await window.screenshot({ path: path.join(outDir, `${name}.png`) })
  console.log(`captured ${name}`)
}

// Approvals dock
await window.click('text=Approvals').catch(() => {})
await window.waitForTimeout(500)
await window.screenshot({ path: path.join(outDir, 'approvals.png') })

const errors = []
window.on('pageerror', (err) => errors.push(String(err)))
window.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
await window.waitForTimeout(500)

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors')
await app.close()
