import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalModelAdapter, listModels } from '../src/main/runtime/providers/local-openai'
import type { ProviderRunRequest, ProviderRunHandlers } from '../src/main/runtime/provider-types'

/**
 * The local provider, driven against a real OpenAI-compatible server.
 *
 * A stub speaking the same wire protocol as LM Studio and Ollama, over real
 * HTTP: the point of this adapter is that it works with whatever is listening
 * on a port, so testing it against a mock of itself would prove nothing. What
 * matters is that a tool call the server emits comes back out through
 * `onToolCall` — a local model must not be a way around the permission gate.
 */

let server: Server
let baseUrl: string
/** Queued responses, one per request the adapter makes. */
let script: unknown[]
let received: Array<Record<string, unknown>>

beforeEach(async () => {
  script = []
  received = []
  server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder' }, { id: 'llama3.1' }] }))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push(JSON.parse(body || '{}'))
      const next = script.shift()
      if (!next) {
        res.statusCode = 500
        res.end('the script ran out')
        return
      }
      if (typeof next === 'number') {
        res.statusCode = next
        res.end(JSON.stringify({ error: { message: 'no such model' } }))
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(next))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function reply(content: string | null, toolCalls: unknown[] = []): unknown {
  return {
    choices: [
      {
        message: { content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop'
      }
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7 }
  }
}

function call(name: string, args: string, id = 'call_1'): unknown {
  return { id, type: 'function', function: { name, arguments: args } }
}

function adapter(model = 'qwen2.5-coder'): LocalModelAdapter {
  return new LocalModelAdapter(() => ({ baseUrl, apiKey: null, defaultModel: model }))
}

function request(over: Partial<ProviderRunRequest> = {}): ProviderRunRequest {
  return {
    executionId: 'exec_1',
    agentName: 'Worker',
    systemPrompt: 'You are a worker.',
    prompt: 'Do the thing.',
    model: '',
    temperature: 0.2,
    tools: [
      {
        name: 'complete_task',
        description: 'Finish the task.',
        inputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
        requiredPermissions: []
      }
    ],
    permissions: [],
    maxIterations: 6,
    maxRuntimeMs: 10_000,
    workspaceDir: null,
    signal: new AbortController().signal,
    ...over
  }
}

function handlers(
  onCall: (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>
): ProviderRunHandlers & { calls: Array<{ name: string; input: Record<string, unknown> }> } {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = []
  return {
    calls,
    onText: () => undefined,
    onIteration: () => undefined,
    onUsage: () => undefined,
    onToolCall: async (name, input) => {
      calls.push({ name, input })
      return onCall(name, input)
    }
  }
}

describe('talking to a local server', () => {
  it('reports what the server is actually serving', async () => {
    expect(await listModels(baseUrl, null)).toEqual(['qwen2.5-coder', 'llama3.1'])
    const availability = await adapter().check()
    expect(availability.available).toBe(true)
    expect(availability.detail).toContain('qwen2.5-coder')
  })

  it('says plainly when nothing is listening rather than failing obscurely', async () => {
    const dead = new LocalModelAdapter(() => ({
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: null,
      defaultModel: 'x'
    }))
    const availability = await dead.check()
    expect(availability.available).toBe(false)
    expect(availability.detail).toContain('Is the server running?')
  })

  it('refuses when no server is configured at all', async () => {
    const bare = new LocalModelAdapter(() => ({ baseUrl: '', apiKey: null, defaultModel: '' }))
    expect((await bare.check()).available).toBe(false)
  })
})

describe('the tool loop', () => {
  it('routes a tool call back through the runtime and feeds the result in', async () => {
    script = [
      reply(null, [call('complete_task', JSON.stringify({ summary: 'did it' }))]),
      reply('All finished.')
    ]
    const h = handlers(async () => ({ ok: true, content: 'recorded' }))
    const result = await adapter().run(request(), h)

    // The call reached the gate, with its arguments intact.
    expect(h.calls).toEqual([{ name: 'complete_task', input: { summary: 'did it' } }])
    expect(result.stopReason).toBe('end')
    expect(result.error).toBeUndefined()
    expect(result.text).toContain('All finished.')

    // ...and the result was handed back to the model as a tool message.
    const second = received[1] as { messages: Array<Record<string, unknown>> }
    const toolMessage = second.messages.find((m) => m.role === 'tool')
    expect(toolMessage).toMatchObject({ content: 'recorded', tool_call_id: 'call_1' })
  })

  it('sends the tools in the schema the servers expect', async () => {
    script = [reply('hello', [call('complete_task', '{}')]), reply('done')]
    await adapter().run(request(), handlers(async () => ({ ok: true, content: 'ok' })))
    const first = received[0] as { tools: Array<Record<string, any>>; model: string }
    expect(first.model).toBe('qwen2.5-coder')
    expect(first.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'complete_task' }
    })
  })

  it('tells the model when its arguments were not JSON instead of dying', async () => {
    script = [reply(null, [call('complete_task', '{summary: not json')]), reply('sorry')]
    const h = handlers(async () => ({ ok: true, content: 'unreachable' }))
    const result = await adapter().run(request(), h)

    // The malformed call never reached the gate...
    expect(h.calls).toHaveLength(0)
    // ...and the model was told why, so it can correct itself.
    const second = received[1] as { messages: Array<Record<string, unknown>> }
    const toolMessage = second.messages.find((m) => m.role === 'tool')
    expect(String(toolMessage?.content)).toContain('not valid JSON')
    expect(result.stopReason).toBe('end')
  })

  it('counts tokens but charges nothing, because it costs nothing', async () => {
    script = [reply('just talking', [call('complete_task', '{}')]), reply('done')]
    const result = await adapter().run(request(), handlers(async () => ({ ok: true, content: 'ok' })))
    expect(result.usage.costUsd).toBe(0)
    expect(result.usage.inputTokens).toBe(22)
    expect(result.usage.outputTokens).toBe(14)
    expect(result.usage.toolCalls).toBe(1)
  })

  it('will not report a clean run when the model never called a tool', async () => {
    // A chat-only model looks like it worked and did nothing. Say so.
    script = [reply('Sure, I would start by reading the file.')]
    const result = await adapter().run(request(), handlers(async () => ({ ok: true, content: '' })))
    expect(result.error).toContain('never called a tool')
    expect(result.error).toContain('tool-calling')
  })

  it('stops at the iteration limit rather than looping forever', async () => {
    script = Array.from({ length: 10 }, () => reply(null, [call('complete_task', '{}')]))
    const result = await adapter().run(
      request({ maxIterations: 3 }),
      handlers(async () => ({ ok: true, content: 'again' }))
    )
    expect(result.stopReason).toBe('max_iterations')
    expect(result.iterations).toBe(3)
  })

  it('explains a 404 as the wrong model name', async () => {
    script = [404]
    const result = await adapter().run(request(), handlers(async () => ({ ok: true, content: '' })))
    expect(result.error).toContain('does not have a model called "qwen2.5-coder"')
  })

  it('refuses when no model has been chosen', async () => {
    const bare = new LocalModelAdapter(() => ({ baseUrl, apiKey: null, defaultModel: '' }))
    const result = await bare.run(request(), handlers(async () => ({ ok: true, content: '' })))
    expect(result.error).toContain('No local model chosen')
  })
})
