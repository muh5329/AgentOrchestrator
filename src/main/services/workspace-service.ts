import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppContext } from '../core/context'
import { AppError } from '../core/errors'
import { id } from '../util/id'

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
  modifiedAt?: number
}

export interface ConsoleSession {
  id: string
  command: string
  cwd: string
  running: boolean
  exitCode: number | null
  startedAt: number
}

const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  '.next',
  '.cache',
  '.DS_Store',
  '__pycache__',
  '.venv',
  'venv',
  'target'
])

const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * The workspace layer behind the editor and console.
 *
 * Everything is resolved relative to a project's workspace and refuses to
 * escape it, so the UI cannot be talked into reading `/etc/passwd` by a crafted
 * path any more than an agent can.
 */
export class WorkspaceService {
  private readonly sessions = new Map<string, { child: ChildProcess; meta: ConsoleSession }>()

  constructor(private readonly ctx: AppContext) {}

  /** The directory a project works in, creating it if necessary. */
  async rootFor(projectId: string, agentId?: string | null): Promise<string> {
    const project = this.ctx.projects.get(projectId)
    const shared = project.rootPath ?? path.join(this.ctx.paths.workspaces, project.id)
    await fs.mkdir(shared, { recursive: true })
    if (!agentId) return shared
    try {
      return await this.ctx.git.ensureAgentWorkspace(agentId, shared)
    } catch {
      return shared
    }
  }

  private resolve(root: string, relative: string): string {
    const target = path.resolve(root, relative || '.')
    const rel = path.relative(root, target)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new AppError(`Refused: "${relative}" is outside the workspace.`, 'OUTSIDE_WORKSPACE')
    }
    return target
  }

  async list(projectId: string, relative = '.', agentId?: string | null): Promise<FileNode[]> {
    const root = await this.rootFor(projectId, agentId)
    const dir = this.resolve(root, relative)

    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full)
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: rel, kind: 'dir' })
        continue
      }
      try {
        const stat = await fs.stat(full)
        nodes.push({
          name: entry.name,
          path: rel,
          kind: 'file',
          size: stat.size,
          modifiedAt: stat.mtimeMs
        })
      } catch {
        /* vanished between readdir and stat */
      }
    }

    return nodes.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
    )
  }

  async read(
    projectId: string,
    relative: string,
    agentId?: string | null
  ): Promise<{ path: string; content: string; truncated: boolean; size: number }> {
    const root = await this.rootFor(projectId, agentId)
    const target = this.resolve(root, relative)
    const stat = await fs.stat(target)

    if (stat.size > MAX_FILE_BYTES) {
      const handle = await fs.open(target, 'r')
      const buf = Buffer.alloc(MAX_FILE_BYTES)
      await handle.read(buf, 0, MAX_FILE_BYTES, 0)
      await handle.close()
      return { path: relative, content: buf.toString('utf8'), truncated: true, size: stat.size }
    }

    return {
      path: relative,
      content: await fs.readFile(target, 'utf8'),
      truncated: false,
      size: stat.size
    }
  }

  async write(
    projectId: string,
    relative: string,
    content: string,
    agentId?: string | null
  ): Promise<void> {
    const root = await this.rootFor(projectId, agentId)
    const target = this.resolve(root, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
    this.ctx.bus.emit({
      type: 'SYSTEM',
      projectId,
      level: 'debug',
      message: `You edited ${relative}`,
      data: { path: relative }
    })
  }

  /* ---------------------------- console ---------------------------- */

  /**
   * Runs a command and streams its output over the event bus.
   *
   * This is a command runner, not a pseudo-terminal: there is no TTY, so
   * interactive programs will not behave as they would in a real shell. It is
   * deliberate - a PTY means another native module, and the thing people
   * actually need here is to run a build and watch it scroll.
   */
  async runCommand(input: {
    projectId: string
    command: string
    agentId?: string | null
    cwd?: string
  }): Promise<ConsoleSession> {
    const root = await this.rootFor(input.projectId, input.agentId)
    const cwd = input.cwd ? this.resolve(root, input.cwd) : root
    const sessionId = id('csl')

    const child = spawn('/bin/sh', ['-c', input.command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' }
    })

    const meta: ConsoleSession = {
      id: sessionId,
      command: input.command,
      cwd,
      running: true,
      exitCode: null,
      startedAt: Date.now()
    }
    this.sessions.set(sessionId, { child, meta })

    const emit = (stream: 'stdout' | 'stderr', chunk: string): void => {
      this.ctx.bus.emit({
        type: 'CONSOLE_OUTPUT',
        projectId: input.projectId,
        level: stream === 'stderr' ? 'warn' : 'debug',
        message: chunk,
        data: { sessionId, stream },
        persist: false
      })
    }

    child.stdout.on('data', (d: Buffer) => emit('stdout', d.toString()))
    child.stderr.on('data', (d: Buffer) => emit('stderr', d.toString()))

    child.on('error', (err) => {
      emit('stderr', `${err.message}\n`)
    })

    child.on('close', (code) => {
      meta.running = false
      meta.exitCode = code
      this.ctx.bus.emit({
        type: 'CONSOLE_EXIT',
        projectId: input.projectId,
        level: code === 0 ? 'info' : 'warn',
        message: `${input.command} exited with ${code}`,
        data: { sessionId, exitCode: code }
      })
      // Keep the record briefly so the UI can read the final state.
      setTimeout(() => this.sessions.delete(sessionId), 60_000)
    })

    this.ctx.bus.emit({
      type: 'SYSTEM',
      projectId: input.projectId,
      level: 'info',
      message: `Console: ${input.command}`,
      data: { sessionId, cwd }
    })

    return meta
  }

  killCommand(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.child.kill('SIGKILL')
    return true
  }

  listSessions(): ConsoleSession[] {
    return [...this.sessions.values()].map((s) => s.meta)
  }

  stopAll(): void {
    for (const session of this.sessions.values()) session.child.kill('SIGKILL')
    this.sessions.clear()
  }
}
