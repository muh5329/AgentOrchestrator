/**
 * Standalone MCP stdio server.
 *
 * The Claude Code CLI spawns this file and speaks MCP to it. Everything it
 * offers is proxied straight back to the Agent Orchestrator control server, so
 * the agent's toolkit, permissions and approval gates are identical whether the
 * loop is driven by the CLI or by our own runtime.
 *
 * Runs under `ELECTRON_RUN_AS_NODE=1` so it works from inside a packaged app.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

interface BridgeTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const controlUrl = process.env.AO_CONTROL_URL
const secret = process.env.AO_CONTROL_TOKEN
const executionId = process.env.AO_EXECUTION_ID

if (!controlUrl || !secret || !executionId) {
  console.error('[ao-bridge] missing AO_CONTROL_URL, AO_CONTROL_TOKEN or AO_EXECUTION_ID')
  process.exit(1)
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${controlUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ executionId, ...body })
  })
  if (!response.ok) throw new Error(`control server ${response.status}`)
  return (await response.json()) as T
}

async function main(): Promise<void> {
  const server = new Server(
    { name: 'agent-orchestrator', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = await post<{ tools: BridgeTool[] }>('/tools/list', {})
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await post<{ ok: boolean; content: string }>('/tools/call', {
        name: request.params.name,
        input: (request.params.arguments ?? {}) as Record<string, unknown>
      })
      return {
        content: [{ type: 'text' as const, text: result.content }],
        isError: !result.ok
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Bridge error: ${(err as Error).message}` }],
        isError: true
      }
    }
  })

  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  console.error('[ao-bridge] fatal', err)
  process.exit(1)
})
