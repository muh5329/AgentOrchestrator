import type { AppContext } from '../../core/context'
import type { Permission } from '../../../shared/domain'

export type JsonSchema = Record<string, unknown>

export interface ExecutionOutcomeSignal {
  kind: 'completed' | 'blocked' | 'failed'
  summary: string
  data?: Record<string, unknown>
}

/** Everything a tool needs to know about the execution invoking it. */
export interface ToolInvocation {
  ctx: AppContext
  projectId: string
  agentId: string
  taskId: string | null
  executionId: string
  depth: number
  signal: AbortSignal
  workspaceDir: string | null
  /** Tools call this to end the execution deliberately. */
  finish(outcome: ExecutionOutcomeSignal): void
  /** Number of child agents this execution has already spawned. */
  spawnedAgents: string[]
}

export interface ToolResult {
  ok: boolean
  content: string
  data?: unknown
}

export interface ToolDefinition {
  name: string
  description: string
  toolkit: string
  inputSchema: JsonSchema
  requiredPermissions: Permission[]
  /** Dangerous tools additionally consult the project's approval policy. */
  dangerous?: boolean
  timeoutMs?: number
  handler(input: Record<string, unknown>, inv: ToolInvocation): Promise<ToolResult>
}

export function ok(content: string, data?: unknown): ToolResult {
  return { ok: true, content, data }
}

export function fail(content: string, data?: unknown): ToolResult {
  return { ok: false, content, data }
}

/** Minimal JSON Schema validation - enough to catch bad agent output early. */
export function validateInput(
  schema: JsonSchema,
  input: Record<string, unknown>
): { valid: true } | { valid: false; error: string } {
  const required = (schema.required as string[] | undefined) ?? []
  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      return { valid: false, error: `Missing required parameter "${key}".` }
    }
  }
  const props = (schema.properties as Record<string, { type?: string }> | undefined) ?? {}
  for (const [key, value] of Object.entries(input)) {
    const spec = props[key]
    if (!spec?.type || value === undefined || value === null) continue
    const actual = Array.isArray(value) ? 'array' : typeof value
    const expected = spec.type
    if (expected === 'number' && actual === 'string' && !Number.isNaN(Number(value))) continue
    if (expected === 'integer' && (actual === 'number' || actual === 'string')) continue
    if (expected === 'object' && actual === 'object') continue
    if (expected !== actual) {
      return { valid: false, error: `Parameter "${key}" should be ${expected}, got ${actual}.` }
    }
  }
  return { valid: true }
}

export const str = (description: string): JsonSchema => ({ type: 'string', description })
export const num = (description: string): JsonSchema => ({ type: 'number', description })
export const bool = (description: string): JsonSchema => ({ type: 'boolean', description })
export const arr = (description: string, items: JsonSchema): JsonSchema => ({
  type: 'array',
  description,
  items
})
export const obj = (
  properties: Record<string, JsonSchema>,
  required: string[] = []
): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
