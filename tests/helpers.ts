import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bootstrap, type BootstrappedApp } from '../src/main/core/bootstrap'
import type { ScriptedAdapter } from '../src/main/runtime/providers/scripted'

export interface TestApp extends BootstrappedApp {
  scripted: ScriptedAdapter
  tmpDir: string
  dispose(): Promise<void>
}

const MIGRATIONS = path.resolve(__dirname, '../drizzle')

export async function createTestApp(
  options: { startEngines?: boolean; tickMs?: number; dir?: string; keepDir?: boolean } = {}
): Promise<TestApp> {
  const tmpDir = options.dir ?? mkdtempSync(path.join(os.tmpdir(), 'ao-test-'))
  const app = bootstrap({
    userData: tmpDir,
    dbFile: path.join(tmpDir, 'test.db'),
    migrations: MIGRATIONS,
    enableScriptedProvider: true,
    startEngines: options.startEngines ?? false,
    executor: { tickMs: options.tickMs ?? 25, globalConcurrency: 8 },
    schedulerTickMs: 25,
    watchdogIntervalMs: 100_000
  })
  await app.start()

  const scripted = app.ctx.providers.scripted()
  if (!scripted) throw new Error('scripted provider was not registered')

  return {
    ...app,
    scripted,
    tmpDir,
    async dispose() {
      await app.close()
      if (!options.keepDir) rmSync(tmpDir, { recursive: true, force: true })
    }
  }
}

/** Waits for a predicate to hold, polling until the timeout elapses. */
export async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const intervalMs = options.intervalMs ?? 20
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(options.message ?? `Timed out after ${timeoutMs}ms waiting for condition`)
}

export function scriptedProject(app: TestApp, overrides: Record<string, unknown> = {}) {
  return app.ctx.projects.create({
    name: 'Test project',
    mission: 'Prove the loop works',
    settings: { defaultProvider: 'scripted', defaultModel: 'test-model' },
    ...overrides
  })
}
