import { emptyUsage, type UsageTotals } from '../../../shared/domain'
import type {
  ProviderAdapter,
  ProviderAvailability,
  ProviderRunHandlers,
  ProviderRunRequest,
  ProviderRunResult
} from '../provider-types'

export type ScriptStep =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'end' }

export interface ScriptTurnContext {
  request: ProviderRunRequest
  turn: number
  lastResults: Array<{ name: string; ok: boolean; content: string }>
}

export type Responder = (ctx: ScriptTurnContext) => ScriptStep[] | Promise<ScriptStep[]>

/**
 * A deterministic provider used by the test suite and by the "dry run" mode.
 *
 * It exercises exactly the same runtime path as a real model - the same tool
 * gateway, the same events, the same judging - without spending tokens or
 * depending on a CLI being installed. It is only selectable when explicitly
 * enabled, so it can never stand in for a real provider in normal use.
 */
export class ScriptedAdapter implements ProviderAdapter {
  readonly id = 'scripted'
  readonly label = 'Scripted (testing)'
  readonly kind = 'internal' as const
  readonly hostsOwnToolLoop = false

  private responder: Responder = () => [{ type: 'end' }]

  setResponder(responder: Responder): void {
    this.responder = responder
  }

  async check(): Promise<ProviderAvailability> {
    return { available: true, detail: 'Deterministic in-process provider.' }
  }

  async run(
    request: ProviderRunRequest,
    handlers: ProviderRunHandlers
  ): Promise<ProviderRunResult> {
    const usage: UsageTotals = emptyUsage()
    const startedAt = Date.now()
    let text = ''
    let iterations = 0
    let lastResults: Array<{ name: string; ok: boolean; content: string }> = []

    while (iterations < request.maxIterations) {
      if (request.signal.aborted) {
        usage.durationMs = Date.now() - startedAt
        return { text, usage, iterations, stopReason: 'aborted' }
      }

      iterations += 1
      handlers.onIteration(iterations)
      const steps = await this.responder({ request, turn: iterations, lastResults })
      lastResults = []

      let ended = false
      for (const step of steps) {
        if (step.type === 'end') {
          ended = true
          break
        }
        if (step.type === 'text') {
          text += `${step.text}\n`
          handlers.onText(step.text)
          continue
        }
        const result = await handlers.onToolCall(step.name, step.input)
        lastResults.push({ name: step.name, ok: result.ok, content: result.content })
        usage.toolCalls += 1
      }

      usage.inputTokens += 500
      usage.outputTokens += 120
      handlers.onUsage({ inputTokens: 500, outputTokens: 120, costUsd: 0 })

      if (ended) {
        usage.durationMs = Date.now() - startedAt
        return { text: text.trim(), usage, iterations, stopReason: 'end' }
      }
    }

    usage.durationMs = Date.now() - startedAt
    return { text: text.trim(), usage, iterations, stopReason: 'max_iterations' }
  }
}
