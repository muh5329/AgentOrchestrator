import { emptyUsage, type UsageTotals } from '../../../shared/domain'
import type {
  ProviderAdapter,
  ProviderAvailability,
  ProviderRunHandlers,
  ProviderRunRequest,
  ProviderRunResult,
  StopReason
} from '../provider-types'

interface ContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface MessagesResponse {
  content: ContentBlock[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

/** Per-million-token pricing used for cost estimates, in US dollars. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 }
}

/**
 * Direct Messages API provider.
 *
 * Unlike the CLI provider this one drives the tool loop itself, which makes it
 * the reference implementation of the runtime contract: every tool call goes
 * back through `handlers.onToolCall` and therefore through ToolRuntime.
 */
export class AnthropicApiAdapter implements ProviderAdapter {
  readonly id = 'anthropic-api'
  readonly label = 'Anthropic API'
  readonly kind = 'api' as const
  readonly hostsOwnToolLoop = false

  constructor(
    private readonly getApiKey: () => string | null,
    private readonly baseUrl = 'https://api.anthropic.com'
  ) {}

  async check(): Promise<ProviderAvailability> {
    const key = this.getApiKey()
    if (!key) {
      return {
        available: false,
        detail: 'No API key configured. Add one in Settings → Providers to enable this provider.'
      }
    }
    return { available: true, detail: 'API key configured.' }
  }

  async run(
    request: ProviderRunRequest,
    handlers: ProviderRunHandlers
  ): Promise<ProviderRunResult> {
    const apiKey = this.getApiKey()
    const usage: UsageTotals = emptyUsage()
    const startedAt = Date.now()
    if (!apiKey) {
      return {
        text: '',
        usage,
        iterations: 0,
        stopReason: 'error',
        error: 'No Anthropic API key configured.'
      }
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
      { role: 'user', content: request.prompt }
    ]
    const tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }))

    let text = ''
    let iterations = 0
    let stopReason: StopReason = 'end'

    while (iterations < request.maxIterations) {
      if (request.signal.aborted) {
        stopReason = 'aborted'
        break
      }
      if (Date.now() - startedAt > request.maxRuntimeMs) {
        stopReason = 'error'
        usage.durationMs = Date.now() - startedAt
        return {
          text,
          usage,
          iterations,
          stopReason,
          error: 'Execution exceeded its runtime limit.'
        }
      }

      iterations += 1
      handlers.onIteration(iterations)

      let response: MessagesResponse
      try {
        const raw = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          signal: request.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: 8192,
            temperature: request.temperature,
            system: request.systemPrompt,
            tools,
            messages
          })
        })
        if (!raw.ok) {
          const body = await raw.text()
          usage.durationMs = Date.now() - startedAt
          return {
            text,
            usage,
            iterations,
            stopReason: 'error',
            error: `Anthropic API ${raw.status}: ${body.slice(0, 500)}`
          }
        }
        response = (await raw.json()) as MessagesResponse
      } catch (err) {
        usage.durationMs = Date.now() - startedAt
        return {
          text,
          usage,
          iterations,
          stopReason: request.signal.aborted ? 'aborted' : 'error',
          error: (err as Error).message
        }
      }

      const price = PRICING[request.model] ?? { input: 3, output: 15 }
      const delta = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd:
          (response.usage.input_tokens / 1_000_000) * price.input +
          (response.usage.output_tokens / 1_000_000) * price.output
      }
      usage.inputTokens += delta.inputTokens
      usage.outputTokens += delta.outputTokens
      usage.costUsd += delta.costUsd
      handlers.onUsage(delta)

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          text += `${block.text}\n`
          handlers.onText(block.text)
        }
      }

      const toolUses = response.content.filter((b) => b.type === 'tool_use')
      if (!toolUses.length) break

      messages.push({ role: 'assistant', content: response.content })
      const results: unknown[] = []
      for (const call of toolUses) {
        const result = await handlers.onToolCall(call.name ?? '', call.input ?? {})
        usage.toolCalls += 1
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: result.content,
          is_error: !result.ok
        })
      }
      messages.push({ role: 'user', content: results })
    }

    if (iterations >= request.maxIterations) stopReason = 'max_iterations'
    usage.durationMs = Date.now() - startedAt
    return { text: text.trim(), usage, iterations, stopReason }
  }
}
