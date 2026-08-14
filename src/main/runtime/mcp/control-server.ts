import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppContext } from '../../core/context'
import type { ToolInvocation } from '../tools/types'
import { token } from '../../util/id'

interface Session {
  invocation: ToolInvocation
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}

/**
 * A loopback control plane for provider subprocesses.
 *
 * The Claude Code CLI runs as a child process and cannot reach into this
 * process directly, so it talks to a tiny MCP bridge which forwards tool calls
 * here over authenticated localhost HTTP. That keeps one enforcement path for
 * permissions and approvals regardless of which provider is driving the loop.
 */
export class ControlServer {
  private server: http.Server | null = null
  private port = 0
  readonly secret = token(32)
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly ctx: AppContext) {}

  async start(): Promise<number> {
    if (this.server) return this.port
    this.server = http.createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    this.port = (this.server.address() as AddressInfo).port
    return this.port
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  register(session: Session): void {
    this.sessions.set(session.invocation.executionId, session)
  }

  unregister(executionId: string): void {
    this.sessions.delete(executionId)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(payload)
    }

    if (req.headers.authorization !== `Bearer ${this.secret}`) {
      return send(401, { error: 'unauthorized' })
    }

    let raw = ''
    for await (const chunk of req) raw += chunk
    let body: { executionId?: string; name?: string; input?: Record<string, unknown> }
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return send(400, { error: 'invalid json' })
    }

    const session = body.executionId ? this.sessions.get(body.executionId) : undefined
    if (!session) return send(404, { error: 'unknown execution' })

    if (req.url === '/tools/list') {
      return send(200, { tools: session.tools })
    }

    if (req.url === '/tools/call') {
      if (!body.name) return send(400, { error: 'missing tool name' })
      try {
        const result = await this.ctx.toolRuntime.call({
          name: body.name,
          input: body.input ?? {},
          invocation: session.invocation
        })
        return send(200, { ok: result.ok, content: result.content })
      } catch (err) {
        return send(200, { ok: false, content: `Tool error: ${(err as Error).message}` })
      }
    }

    return send(404, { error: 'not found' })
  }
}
