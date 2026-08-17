import { createConnection, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import type { AppContext } from '../core/context'
import type { MailConfig } from '../../shared/models'

/**
 * Outbound email over SMTP.
 *
 * Written against the protocol rather than pulled from a package: the surface
 * needed here is EHLO, STARTTLS, AUTH LOGIN, MAIL FROM, RCPT TO, DATA - and a
 * dependency for that is a dependency to install, audit and keep, on a project
 * that has already paid enough for native modules.
 *
 * Nothing is sent until an account is configured. `config()` reports that
 * plainly so the tool can refuse rather than reporting a success no message
 * came from.
 */

export type { MailConfig }

const KEYS = {
  host: 'mail.host',
  port: 'mail.port',
  user: 'mail.user',
  password: 'mail.password',
  from: 'mail.from',
  secure: 'mail.secure'
} as const

export class MailService {
  constructor(private readonly ctx: AppContext) {}

  async config(): Promise<MailConfig> {
    const host = (await this.ctx.providers.getSecret(KEYS.host)) ?? ''
    const user = (await this.ctx.providers.getSecret(KEYS.user)) ?? ''
    const password = (await this.ctx.providers.getSecret(KEYS.password)) ?? ''
    const from = (await this.ctx.providers.getSecret(KEYS.from)) ?? user
    const port = Number((await this.ctx.providers.getSecret(KEYS.port)) ?? 587)
    const secure = (await this.ctx.providers.getSecret(KEYS.secure)) === 'true'

    return {
      configured: Boolean(host && user && password && from),
      host,
      port: Number.isFinite(port) ? port : 587,
      user,
      from,
      secure
    }
  }

  async save(input: Partial<Record<keyof typeof KEYS, string>>): Promise<MailConfig> {
    for (const [field, key] of Object.entries(KEYS)) {
      const value = input[field as keyof typeof KEYS]
      if (value !== undefined) await this.ctx.providers.setSecret(key, value || null)
    }
    return this.config()
  }

  /** Opens a connection and says EHLO, so a bad account fails here not later. */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    const config = await this.config()
    if (!config.configured) return { ok: false, detail: 'No SMTP account is configured.' }
    try {
      const session = await this.open(config)
      await session.send('QUIT', [221])
      session.close()
      return { ok: true, detail: `Connected to ${config.host}:${config.port} as ${config.user}.` }
    } catch (err) {
      return { ok: false, detail: (err as Error).message }
    }
  }

  async send(message: {
    to: string
    subject: string
    body: string
  }): Promise<{ messageId: string }> {
    const config = await this.config()
    if (!config.configured) throw new Error('No SMTP account is configured.')

    const password = (await this.ctx.providers.getSecret(KEYS.password)) ?? ''
    const session = await this.open(config)

    try {
      await session.send(`AUTH LOGIN`, [334])
      await session.send(Buffer.from(config.user).toString('base64'), [334])
      await session.send(Buffer.from(password).toString('base64'), [235])

      await session.send(`MAIL FROM:<${config.from}>`, [250])
      await session.send(`RCPT TO:<${message.to}>`, [250, 251])
      await session.send('DATA', [354])

      const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@agent-orchestrator>`
      const headers = [
        `From: ${config.from}`,
        `To: ${message.to}`,
        `Subject: ${message.subject.replace(/[\r\n]/g, ' ')}`,
        `Message-ID: ${messageId}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8'
      ].join('\r\n')

      // Dot-stuffing: a line that is a single dot would otherwise end the DATA
      // block early and truncate the message.
      const body = message.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
      await session.send(`${headers}\r\n\r\n${body}\r\n.`, [250])
      await session.send('QUIT', [221])

      return { messageId }
    } finally {
      session.close()
    }
  }

  /** Connects, upgrades to TLS when the server offers it, and greets. */
  private async open(config: MailConfig): Promise<SmtpSession> {
    let socket: Socket | TLSSocket = config.secure
      ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
      : createConnection({ host: config.host, port: config.port })

    let session = new SmtpSession(socket)
    await session.expect([220])
    const greeting = await session.send(`EHLO agent-orchestrator`, [250])

    if (!config.secure && /STARTTLS/i.test(greeting)) {
      await session.send('STARTTLS', [220])
      socket = tlsConnect({ socket, servername: config.host })
      session = new SmtpSession(socket)
      await new Promise<void>((resolve, reject) => {
        ;(socket as TLSSocket).once('secureConnect', () => resolve())
        socket.once('error', reject)
      })
      await session.send(`EHLO agent-orchestrator`, [250])
    }

    return session
  }
}

/**
 * One SMTP conversation.
 *
 * Replies are multi-line: `250-FIRST` continues, `250 LAST` ends. Reading until
 * a line with a space in the fourth position is the whole protocol subtlety.
 */
class SmtpSession {
  private buffer = ''
  private waiter: ((value: string) => void) | null = null
  private failer: ((err: Error) => void) | null = null

  constructor(private readonly socket: Socket | TLSSocket) {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      this.buffer += chunk
      const lines = this.buffer.split(/\r?\n/)
      const last = lines.filter(Boolean).pop() ?? ''
      if (/^\d{3} /.test(last)) {
        const reply = this.buffer
        this.buffer = ''
        this.waiter?.(reply)
        this.waiter = null
        this.failer = null
      }
    })
    socket.on('error', (err) => {
      this.failer?.(err)
      this.waiter = null
      this.failer = null
    })
  }

  expect(codes: number[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The mail server did not reply in time.')), 20_000)
      this.waiter = (reply) => {
        clearTimeout(timer)
        const code = Number(reply.slice(0, 3))
        if (codes.includes(code)) resolve(reply)
        else reject(new Error(`The mail server said: ${reply.trim()}`))
      }
      this.failer = (err) => {
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  async send(line: string, codes: number[]): Promise<string> {
    const reply = this.expect(codes)
    this.socket.write(`${line}\r\n`)
    return reply
  }

  close(): void {
    this.socket.end()
    this.socket.destroy()
  }
}
