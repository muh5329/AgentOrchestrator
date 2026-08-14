import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptyUsage, type UsageTotals } from '../../../shared/domain'
import type {
  ProviderAdapter,
  ProviderAvailability,
  ProviderRunHandlers,
  ProviderRunRequest,
  ProviderRunResult,
  StopReason
} from '../provider-types'

export interface ClaudeCodeOptions {
  /** Absolute path to the built MCP bridge script. */
  bridgeEntry: string
  /** Lazily read so the control server can bind its port first. */
  controlUrl: () => string
  controlToken: string
  /** Electron's binary, run as plain node for the bridge child process. */
  nodeExecPath: string
  binary?: string
}

/**
 * Maps Agent Orchestrator permissions onto the CLI's own tool names, so an
 * agent that may not write files genuinely cannot, even through the provider's
 * native tooling.
 */
const NATIVE_TOOLS_BY_PERMISSION: Record<string, string[]> = {
  FILES_READ: ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'],
  FILES_WRITE: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
  SHELL_EXECUTE: ['Bash', 'BashOutput', 'KillBash'],
  WEB_ACCESS: ['WebFetch', 'WebSearch'],
  NETWORK_ACCESS: ['WebFetch']
}

const ALL_NATIVE_TOOLS = Array.from(
  new Set(Object.values(NATIVE_TOOLS_BY_PERMISSION).flat())
)

/**
 * Runs an agent execution through the locally installed Claude Code CLI.
 *
 * The CLI drives its own tool loop; our orchestration tools reach it as an MCP
 * server (`mcp__ao__*`) proxied by the bridge, so tool calls still flow through
 * ToolRuntime with permission checks and approvals intact.
 */
export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly id = 'claude-code'
  readonly label = 'Claude Code CLI'
  readonly kind = 'cli' as const
  readonly hostsOwnToolLoop = true

  constructor(private readonly options: ClaudeCodeOptions) {}

  private get binary(): string {
    return this.options.binary ?? process.env.AO_CLAUDE_BIN ?? 'claude'
  }

  async check(): Promise<ProviderAvailability> {
    return new Promise((resolve) => {
      const child = spawn(this.binary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.on('error', () =>
        resolve({
          available: false,
          detail:
            `Could not run "${this.binary}". Install the Claude Code CLI and make sure it is on ` +
            `your PATH, or set AO_CLAUDE_BIN to its absolute path.`
        })
      )
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ available: true, detail: out.trim(), version: out.trim() })
        } else {
          resolve({ available: false, detail: `"${this.binary} --version" exited with ${code}.` })
        }
      })
    })
  }

  async run(
    request: ProviderRunRequest,
    handlers: ProviderRunHandlers
  ): Promise<ProviderRunResult> {
    const usage: UsageTotals = emptyUsage()
    const startedAt = Date.now()
    const cwd = request.workspaceDir ?? os.tmpdir()

    const mcpConfigPath = path.join(
      os.tmpdir(),
      `ao-mcp-${request.executionId}-${Date.now()}.json`
    )
    await fs.writeFile(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          ao: {
            command: this.options.nodeExecPath,
            args: [this.options.bridgeEntry],
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              AO_CONTROL_URL: this.options.controlUrl(),
              AO_CONTROL_TOKEN: this.options.controlToken,
              AO_EXECUTION_ID: request.executionId
            }
          }
        }
      }),
      'utf8'
    )

    const allowedNative = new Set<string>()
    for (const permission of request.permissions) {
      for (const tool of NATIVE_TOOLS_BY_PERMISSION[permission] ?? []) allowedNative.add(tool)
    }
    const disallowedNative = ALL_NATIVE_TOOLS.filter((t) => !allowedNative.has(t))

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      request.model,
      '--append-system-prompt',
      request.systemPrompt,
      '--mcp-config',
      mcpConfigPath,
      '--strict-mcp-config',
      '--max-turns',
      String(request.maxIterations),
      '--permission-mode',
      allowedNative.has('Write') ? 'acceptEdits' : 'default',
      '--allowedTools',
      ['mcp__ao', ...allowedNative].join(',')
    ]
    if (disallowedNative.length) args.push('--disallowedTools', disallowedNative.join(','))

    return new Promise<ProviderRunResult>((resolve) => {
      const child = spawn(this.binary, args, {
        cwd,
        env: { ...process.env, AO_EXECUTION_ID: request.executionId },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let text = ''
      let stderr = ''
      let iterations = 0
      let stopReason: StopReason = 'end'
      let errorMessage: string | undefined
      let buffer = ''
      let settled = false

      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        request.signal.removeEventListener('abort', onAbort)
        usage.durationMs = Date.now() - startedAt
        void fs.unlink(mcpConfigPath).catch(() => undefined)
        resolve({ text: text.trim(), usage, iterations, stopReason, error: errorMessage })
      }

      const timer = setTimeout(() => {
        stopReason = 'error'
        errorMessage = `Execution exceeded its ${Math.round(request.maxRuntimeMs / 1000)}s runtime limit.`
        child.kill('SIGKILL')
      }, request.maxRuntimeMs)

      const onAbort = (): void => {
        stopReason = 'aborted'
        child.kill('SIGKILL')
      }
      request.signal.addEventListener('abort', onAbort, { once: true })

      child.stdin.write(request.prompt)
      child.stdin.end()

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (!line) continue
          let event: Record<string, unknown>
          try {
            event = JSON.parse(line)
          } catch {
            continue
          }
          this.consume(event, {
            onText: (t) => {
              text += t
              handlers.onText(t)
            },
            onIteration: () => {
              iterations += 1
              handlers.onIteration(iterations)
            },
            onUsage: (delta) => {
              usage.inputTokens += delta.inputTokens ?? 0
              usage.outputTokens += delta.outputTokens ?? 0
              usage.costUsd += delta.costUsd ?? 0
              handlers.onUsage(delta)
            },
            onError: (message) => {
              errorMessage = message
              stopReason = 'error'
            },
            onMaxTurns: () => {
              stopReason = 'max_iterations'
            }
          })
        }
      })

      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString()
      })

      child.on('error', (err) => {
        stopReason = 'error'
        errorMessage = `Could not start "${this.binary}": ${err.message}`
        finish()
      })

      child.on('close', (code) => {
        if (code !== 0 && stopReason === 'end') {
          stopReason = 'error'
          errorMessage =
            errorMessage ?? `${this.binary} exited with code ${code}. ${stderr.slice(-800)}`
        }
        finish()
      })
    })
  }

  /** Translates one stream-json event into runtime callbacks. */
  private consume(
    event: Record<string, unknown>,
    sink: {
      onText(text: string): void
      onIteration(): void
      onUsage(delta: Partial<UsageTotals>): void
      onError(message: string): void
      onMaxTurns(): void
    }
  ): void {
    const type = String(event.type ?? '')

    if (type === 'assistant') {
      sink.onIteration()
      const message = event.message as { content?: Array<Record<string, unknown>> } | undefined
      for (const block of message?.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string') sink.onText(block.text)
      }
      return
    }

    if (type === 'result') {
      const subtype = String(event.subtype ?? '')
      const rawUsage = (event.usage ?? {}) as Record<string, number>
      sink.onUsage({
        inputTokens: Number(rawUsage.input_tokens ?? 0) + Number(rawUsage.cache_read_input_tokens ?? 0),
        outputTokens: Number(rawUsage.output_tokens ?? 0),
        costUsd: Number(event.total_cost_usd ?? 0)
      })
      if (subtype === 'error_max_turns') sink.onMaxTurns()
      if (subtype === 'error_during_execution') {
        sink.onError(String(event.result ?? 'The provider reported an error during execution.'))
      }
      if (subtype === 'success' && typeof event.result === 'string' && event.result.trim()) {
        // The final result string is the assistant's closing message; it has
        // already been streamed as text blocks, so it is not appended again.
      }
    }
  }
}
