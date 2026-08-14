import { spawn } from 'node:child_process'
import { fail, num, obj, ok, str, type ToolDefinition, type ToolInvocation } from './types'

const TOOLKIT = 'Execution'

export interface ShellResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Runs a command in the workspace with a hard timeout and captured output. */
export function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: { ...process.env, CI: '1' }
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const cap = 200_000
    child.stdout.on('data', (d) => {
      if (stdout.length < cap) stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      if (stderr.length < cap) stderr += d.toString()
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout: stdout.slice(0, cap), stderr: stderr.slice(0, cap), timedOut })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: String(err), timedOut })
    })
  })
}

export const executionTools: ToolDefinition[] = [
  {
    name: 'run_shell',
    toolkit: TOOLKIT,
    description:
      'Run a shell command in the project workspace and return its output. Every command is ' +
      'logged. Destructive commands are gated by human approval.',
    requiredPermissions: ['SHELL_EXECUTE'],
    dangerous: true,
    timeoutMs: 10 * 60_000,
    inputSchema: obj(
      { command: str('The command to run.'), timeout_ms: num('Default 120000.') },
      ['command']
    ),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const command = String(input.command)
      const result = await runShell(
        command,
        inv.workspaceDir,
        Number(input.timeout_ms ?? 120_000),
        inv.signal
      )
      const body =
        `exit ${result.code ?? 'killed'}${result.timedOut ? ' (timed out)' : ''}\n` +
        (result.stdout ? `stdout:\n${result.stdout}\n` : '') +
        (result.stderr ? `stderr:\n${result.stderr}` : '')
      return result.code === 0 ? ok(body, result) : fail(body, result)
    }
  },

  {
    name: 'run_tests',
    toolkit: TOOLKIT,
    description:
      'Run the project test suite and return the result. The Judge treats a passing run as ' +
      'evidence, and a failing run as a rejection.',
    requiredPermissions: ['SHELL_EXECUTE'],
    timeoutMs: 15 * 60_000,
    inputSchema: obj({ command: str('Override the test command. Default "npm test".') }),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const command = String(input.command ?? 'npm test')
      const result = await runShell(command, inv.workspaceDir, 15 * 60_000, inv.signal)
      inv.ctx.artifacts.create({
        projectId: inv.projectId,
        taskId: inv.taskId,
        executionId: inv.executionId,
        agentId: inv.agentId,
        kind: 'test-report',
        title: `Test run: ${command}`,
        content: `${result.stdout}\n${result.stderr}`.slice(0, 20_000),
        meta: { exitCode: result.code, passed: result.code === 0 }
      })
      const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-4000)
      return result.code === 0
        ? ok(`Tests passed.\n${tail}`, result)
        : fail(`Tests failed (exit ${result.code}).\n${tail}`, result)
    }
  }
]

export const webTools: ToolDefinition[] = [
  {
    name: 'web_fetch',
    toolkit: 'Web',
    description: 'Fetch a URL and return its text content.',
    requiredPermissions: ['NETWORK_ACCESS'],
    timeoutMs: 60_000,
    inputSchema: obj({ url: str('Absolute http(s) URL.') }, ['url']),
    async handler(input, inv: ToolInvocation) {
      const url = String(input.url)
      if (!/^https?:\/\//i.test(url)) return fail('Only http and https URLs are allowed.')
      try {
        const response = await fetch(url, { signal: inv.signal })
        const text = await response.text()
        const stripped = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        return ok(`HTTP ${response.status}\n${stripped.slice(0, 40_000)}`)
      } catch (err) {
        return fail(`Fetch failed: ${(err as Error).message}`)
      }
    }
  }
]
