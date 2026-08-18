import { emptyUsage, type UsageTotals } from '../../../shared/domain'
import type {
  ProviderAdapter,
  ProviderAvailability,
  ProviderRunHandlers,
  ProviderRunRequest,
  ProviderRunResult,
  StopReason
} from '../provider-types'

/**
 * Models running on this machine.
 *
 * One adapter rather than one per vendor. LM Studio, Ollama, llama.cpp's server
 * and vLLM all speak the same OpenAI-shaped `/v1/chat/completions` with the same
 * tool-calling envelope, so what varies between them is a base URL - and a base
 * URL is configuration, not code. Anything else that speaks the dialect works
 * here on the day it ships, without this file changing.
 *
 * It drives the tool loop itself, so every call an agent makes still goes back
 * through ToolRuntime and is subject to the same permissions and approvals as
 * any other provider. A local model is not a way around the gate.
 *
 * Cost is recorded as zero, because it is. The tokens are counted anyway: they
 * are what tells you a model is thrashing.
 */

/** The servers worth looking for before asking someone to type a URL. */
export const KNOWN_LOCAL_SERVERS: Array<{ label: string; baseUrl: string }> = [
  { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { label: 'llama.cpp / vLLM', baseUrl: 'http://127.0.0.1:8000/v1' },
  { label: 'Jan / LocalAI', baseUrl: 'http://127.0.0.1:1337/v1' }
]

export interface LocalModelConfig {
  baseUrl: string
  /** Some servers want one, most local ones ignore it entirely. */
  apiKey: string | null
  /** Used when an agent names no model of its own. */
  defaultModel: string
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface ChatResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: ToolCall[] }
    finish_reason: string
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** Strips a trailing slash and adds the /v1 these servers all expose. */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

/** Asks a server what it is serving. Empty when it is not one of these. */
export async function listModels(
  baseUrl: string,
  apiKey: string | null,
  timeoutMs = 4000
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${normaliseBaseUrl(baseUrl)}/models`, {
      signal: controller.signal,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
    })
    if (!response.ok) return []
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    return (body.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Looks for a server already running, so the common case needs no typing. */
export async function detectLocalServers(): Promise<
  Array<{ label: string; baseUrl: string; models: string[] }>
> {
  const found = await Promise.all(
    KNOWN_LOCAL_SERVERS.map(async (server) => ({
      ...server,
      models: await listModels(server.baseUrl, null, 1500)
    }))
  )
  return found.filter((server) => server.models.length > 0)
}

export class LocalModelAdapter implements ProviderAdapter {
  readonly id = 'local'
  readonly label = 'Local models'
  readonly kind = 'api' as const
  readonly hostsOwnToolLoop = false

  constructor(private readonly getConfig: () => LocalModelConfig) {}

  async check(): Promise<ProviderAvailability> {
    const config = this.getConfig()
    if (!config.baseUrl) {
      return {
        available: false,
        detail:
          'No local server configured. Start LM Studio, Ollama or another OpenAI-compatible ' +
          'server and point Settings → Local models at it.'
      }
    }

    const models = await listModels(config.baseUrl, config.apiKey)
    if (!models.length) {
      return {
        available: false,
        detail: `Nothing answered at ${normaliseBaseUrl(config.baseUrl)}. Is the server running?`
      }
    }
    return {
      available: true,
      detail: `${models.length} model${models.length === 1 ? '' : 's'} at ${normaliseBaseUrl(
        config.baseUrl
      )}: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '…' : ''}`,
      version: models[0]
    }
  }

  async run(
    request: ProviderRunRequest,
    handlers: ProviderRunHandlers
  ): Promise<ProviderRunResult> {
    const config = this.getConfig()
    const usage: UsageTotals = emptyUsage()
    const startedAt = Date.now()

    const done = (
      stopReason: StopReason,
      text: string,
      iterations: number,
      error?: string
    ): ProviderRunResult => {
      usage.durationMs = Date.now() - startedAt
      return { text: text.trim(), usage, iterations, stopReason, error }
    }

    if (!config.baseUrl) {
      return done('error', '', 0, 'No local model server is configured.')
    }

    const model = request.model && request.model !== 'sonnet' ? request.model : config.defaultModel
    if (!model) {
      return done(
        'error',
        '',
        0,
        'No local model chosen. Pick one in Settings → Local models, or set the model on the agent.'
      )
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.prompt }
    ]
    const tools = request.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }))

    let text = ''
    let iterations = 0
    let sawToolCall = false

    while (iterations < request.maxIterations) {
      if (request.signal.aborted) return done('aborted', text, iterations)
      if (Date.now() - startedAt > request.maxRuntimeMs) {
        return done('error', text, iterations, 'Execution exceeded its runtime limit.')
      }

      iterations += 1
      handlers.onIteration(iterations)

      let response: ChatResponse
      try {
        const raw = await fetch(`${normaliseBaseUrl(config.baseUrl)}/chat/completions`, {
          method: 'POST',
          signal: request.signal,
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            temperature: request.temperature,
            messages,
            ...(tools.length ? { tools, tool_choice: 'auto' } : {})
          })
        })

        if (!raw.ok) {
          const body = (await raw.text()).slice(0, 500)
          return done('error', text, iterations, this.explain(raw.status, body, model, tools.length))
        }
        response = (await raw.json()) as ChatResponse
      } catch (err) {
        if (request.signal.aborted) return done('aborted', text, iterations)
        return done(
          'error',
          text,
          iterations,
          `Could not reach ${normaliseBaseUrl(config.baseUrl)}: ${(err as Error).message}`
        )
      }

      // Local servers charge nothing, but the token counts are still the thing
      // that tells you a model is looping, so they are recorded.
      const delta = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        costUsd: 0
      }
      usage.inputTokens += delta.inputTokens
      usage.outputTokens += delta.outputTokens
      handlers.onUsage(delta)

      const choice = response.choices?.[0]
      if (!choice) return done('error', text, iterations, 'The server returned no choices.')

      const content = choice.message.content
      if (content) {
        text += `${content}\n`
        handlers.onText(content)
      }

      const calls = choice.message.tool_calls ?? []
      if (!calls.length) break
      sawToolCall = true

      messages.push({
        role: 'assistant',
        content: content ?? null,
        tool_calls: calls
      })

      for (const call of calls) {
        // A small model will sometimes emit arguments that are not JSON. That
        // is a fact about the model, and the agent is told so plainly rather
        // than the run dying on a parse error.
        let input: Record<string, unknown> = {}
        let malformed = ''
        try {
          input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        } catch {
          malformed = call.function.arguments
        }

        const result = malformed
          ? {
              ok: false,
              content:
                `Your arguments for ${call.function.name} were not valid JSON, so nothing ran. ` +
                `Send the arguments as a JSON object. You sent: ${malformed.slice(0, 200)}`
            }
          : await handlers.onToolCall(call.function.name, input)

        usage.toolCalls += 1
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.content
        })
      }
    }

    if (iterations >= request.maxIterations) {
      return done('max_iterations', text, iterations)
    }
    // A model that never called a tool cannot finish a task, because finishing
    // is itself a tool call. Say so rather than reporting a clean run.
    if (!sawToolCall && tools.length) {
      return done(
        'end',
        text,
        iterations,
        `"${model}" replied with text but never called a tool, so nothing was done and the task ` +
          'cannot report itself finished. Local models need tool-calling support for agent work — ' +
          'pick an instruct model that advertises it.'
      )
    }
    return done('end', text, iterations)
  }

  /** Turns the server's HTTP failure into the thing to change. */
  private explain(status: number, body: string, model: string, toolCount: number): string {
    if (status === 404) {
      return (
        `The server does not have a model called "${model}" (404). Pick one from ` +
        'Settings → Local models, where the list comes from the server itself.'
      )
    }
    if (status === 400 && /tool|function/i.test(body) && toolCount) {
      return (
        `"${model}" rejected the tool definitions (400): ${body}\n\n` +
        'This usually means the model or the server build does not support tool calling, which ' +
        'agent work requires. Try an instruct model that advertises tool or function calling.'
      )
    }
    return `The local server returned ${status}: ${body}`
  }
}
