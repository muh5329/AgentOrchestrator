/**
 * Proves which account a run would be billed to, with a key in the environment.
 *
 * The Claude Code CLI prefers an API key over a subscription, and in headless
 * mode always uses one when present - so the interesting case is not the clean
 * machine, it is the machine where somebody exported ANTHROPIC_API_KEY once and
 * forgot. This launches the real app with exactly that environment and reads
 * back what the Providers panel says.
 *
 *   xvfb-run -a node scripts/billing-check.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')
mkdirSync('.shots', { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  timeout: 120_000,
  args: ['.', `--user-data-dir=${path.resolve('.demo-userdata')}`, '--no-sandbox', '--disable-gpu',
         '--force-device-scale-factor=2', '--high-dpi-support=1'],
  // Exactly the situation that produced "credit balance is too low".
  env: { ...process.env, NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-ant-a-key-from-the-shell' }
})
const window = await app.firstWindow()
await window.waitForSelector('text=Agent Orchestrator', { timeout: 30_000 })
await window.waitForTimeout(3500)
const projects = window.locator('[data-pane="projects"]')
const doc = window.locator('[data-pane="document"]')
await projects.locator('button.pl-8').filter({ hasText: 'Settings' }).first().click()
await window.waitForTimeout(2000)
await doc.locator('button:has-text("Re-check providers")').click()
await window.waitForTimeout(3000)
await doc.getByText('Billing account').first().scrollIntoViewIfNeeded()
await window.waitForTimeout(600)
console.log('--- what the app says ---')
console.log(await doc.locator('text=/kept out of runs|signed in to the CLI/').first().innerText().catch(() => 'NOT FOUND'))
console.log(await doc.locator('text=/Claude Code CLI/').first().innerText().catch(() => ''))
await window.screenshot({ path: '.shots/billing.png', scale: 'device' })

const text = await doc.locator('text=/kept out of runs/').count()
await app.close()
if (!text) {
  console.error('\nThe panel did not say the key was being held back.')
  process.exit(1)
}
console.log('\nThe key is present and is being kept out of runs.')
