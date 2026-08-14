import type { UsageTotals } from '../../shared/domain'
import type { ToolResult } from './tools/types'

export interface ProviderToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Permissions the tool needs, used to map onto a provider's native tools. */
  requiredPermissions: string[]
}

export interface ProviderRunRequest {
  executionId: string
  agentName: string
  systemPrompt: string
  prompt: string
  model: string
  temperature: number
  tools: ProviderToolSpec[]
  /** Permissions held by the agent, for providers with their own tool sets. */
  permissions: string[]
  maxIterations: number
  maxRuntimeMs: number
  workspaceDir: string | null
  signal: AbortSignal
}

export interface ProviderRunHandlers {
  onText(text: string): void
  onToolCall(name: string, input: Record<string, unknown>): Promise<ToolResult>
  onUsage(delta: Partial<UsageTotals>): void
  onIteration(iteration: number): void
}

export type StopReason = 'end' | 'max_iterations' | 'aborted' | 'error' | 'finished_by_tool'

export interface ProviderRunResult {
  text: string
  usage: UsageTotals
  iterations: number
  stopReason: StopReason
  error?: string
}

export interface ProviderAvailability {
  available: boolean
  detail: string
  version?: string
}

export interface ProviderAdapter {
  /** Stable identifier stored on agents, e.g. "claude-code". */
  readonly id: string
  readonly label: string
  readonly kind: 'cli' | 'api' | 'internal'
  /**
   * True when this provider drives tool calls itself (through MCP or its own
   * agent loop) rather than handing them back through onToolCall.
   */
  readonly hostsOwnToolLoop: boolean
  check(): Promise<ProviderAvailability>
  run(request: ProviderRunRequest, handlers: ProviderRunHandlers): Promise<ProviderRunResult>
}
