import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AppContext } from '../core/context'
import { AppError } from '../core/errors'

const run = promisify(execFile)

export interface GitStatusEntry {
  path: string
  index: string
  worktree: string
  staged: boolean
  untracked: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  clean: boolean
  entries: GitStatusEntry[]
  root: string | null
}

export interface Worktree {
  path: string
  branch: string | null
  head: string | null
  /** The agent this worktree belongs to, decoded from its branch name. */
  agentId: string | null
  isMain: boolean
}

const BRANCH_PREFIX = 'ao/'

/**
 * Git, and the worktree isolation that makes parallel agents safe.
 *
 * When several agents work on the same repository at once, sharing one checkout
 * means whoever writes last wins. Each agent instead gets its own worktree on
 * its own branch: they edit simultaneously without colliding, and the diff you
 * review at the end is per-agent rather than an indistinguishable mess.
 */
export class GitService {
  constructor(private readonly ctx: AppContext) {}

  private async git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
    const { stdout } = await run('git', args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  }

  private async tryGit(cwd: string, args: string[]): Promise<string | null> {
    try {
      return await this.git(cwd, args)
    } catch {
      return null
    }
  }

  async isRepo(dir: string): Promise<boolean> {
    return (await this.tryGit(dir, ['rev-parse', '--is-inside-work-tree']))?.trim() === 'true'
  }

  async root(dir: string): Promise<string | null> {
    const out = await this.tryGit(dir, ['rev-parse', '--show-toplevel'])
    return out ? out.trim() : null
  }

  async status(dir: string): Promise<GitStatus> {
    const root = await this.root(dir)
    if (!root) {
      return { isRepo: false, branch: null, ahead: 0, behind: 0, clean: true, entries: [], root: null }
    }

    const raw = (await this.tryGit(dir, ['status', '--porcelain=v1', '--branch'])) ?? ''
    const lines = raw.split('\n').filter(Boolean)

    let branch: string | null = null
    let ahead = 0
    let behind = 0
    const entries: GitStatusEntry[] = []

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const header = line.slice(3)
        branch = header.split('...')[0].trim()
        ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? 0)
        behind = Number(header.match(/behind (\d+)/)?.[1] ?? 0)
        continue
      }
      const index = line[0]
      const worktree = line[1]
      entries.push({
        path: line.slice(3).trim(),
        index,
        worktree,
        staged: index !== ' ' && index !== '?',
        untracked: index === '?'
      })
    }

    return { isRepo: true, branch, ahead, behind, clean: entries.length === 0, entries, root }
  }

  async diff(dir: string, options: { file?: string; staged?: boolean } = {}): Promise<string> {
    const args = ['diff', '--no-color']
    if (options.staged) args.push('--staged')
    if (options.file) args.push('--', options.file)
    const out = await this.tryGit(dir, args)
    if (out && out.trim()) return out

    // An untracked file has no diff; show it as an addition so the reviewer
    // still sees what the agent created.
    if (options.file) {
      try {
        const content = await fs.readFile(path.join(dir, options.file), 'utf8')
        return content
          .split('\n')
          .map((line) => `+${line}`)
          .join('\n')
      } catch {
        return ''
      }
    }
    return out ?? ''
  }

  async log(dir: string, limit = 30): Promise<Array<{ hash: string; author: string; date: string; subject: string }>> {
    const out = await this.tryGit(dir, [
      'log',
      `-${limit}`,
      '--pretty=format:%h%an%ad%s',
      '--date=short'
    ])
    if (!out) return []
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, subject] = line.split('')
        return { hash, author, date, subject }
      })
  }

  async commit(dir: string, message: string, addAll = true): Promise<string> {
    if (!(await this.isRepo(dir))) throw new AppError('Not a git repository.', 'NOT_A_REPO')
    if (addAll) await this.git(dir, ['add', '-A'])
    const status = await this.status(dir)
    if (status.clean) return 'Nothing to commit.'
    await this.git(dir, ['-c', 'user.name=Agent Orchestrator', '-c', 'user.email=agents@localhost', 'commit', '-m', message])
    const head = (await this.tryGit(dir, ['rev-parse', '--short', 'HEAD']))?.trim() ?? ''
    this.ctx.bus.emit({
      type: 'GIT_ACTION',
      message: `Committed ${head}: ${message.split('\n')[0]}`,
      data: { dir, head }
    })
    return head
  }

  /* --------------------------- worktrees --------------------------- */

  branchNameFor(agentName: string, agentId: string): string {
    const slug = agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32)
    return `${BRANCH_PREFIX}${slug || 'agent'}-${agentId.slice(-6)}`
  }

  worktreeRootFor(projectId: string): string {
    return path.join(this.ctx.paths.workspaces, `${projectId}-worktrees`)
  }

  async listWorktrees(repoDir: string): Promise<Worktree[]> {
    const out = await this.tryGit(repoDir, ['worktree', 'list', '--porcelain'])
    if (!out) return []

    const worktrees: Worktree[] = []
    let current: Partial<Worktree> = {}
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(this.finishWorktree(current))
        current = { path: line.slice('worktree '.length).trim() }
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5).trim()
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).trim().replace('refs/heads/', '')
      }
    }
    if (current.path) worktrees.push(this.finishWorktree(current))

    return worktrees.map((w, i) => ({ ...w, isMain: i === 0 }))
  }

  private finishWorktree(partial: Partial<Worktree>): Worktree {
    const branch = partial.branch ?? null
    return {
      path: partial.path as string,
      branch,
      head: partial.head ?? null,
      agentId: null,
      isMain: false
    }
  }

  /**
   * Returns the directory an agent should work in, creating its worktree the
   * first time. Falls back to the shared checkout when the project is not a git
   * repository - isolation is a nicety, not a precondition.
   */
  async ensureAgentWorkspace(agentId: string, sharedDir: string): Promise<string> {
    const agent = this.ctx.agents.get(agentId)
    const project = this.ctx.projects.get(agent.projectId)
    if (!project.settings.isolateAgentWorkspaces) return sharedDir

    const repoRoot = await this.root(sharedDir)
    if (!repoRoot) return sharedDir

    const branch = this.branchNameFor(agent.name, agent.id)
    const target = path.join(this.worktreeRootFor(project.id), branch.replace(BRANCH_PREFIX, ''))

    if (await pathExists(path.join(target, '.git'))) return target

    await fs.mkdir(path.dirname(target), { recursive: true })
    try {
      const existingBranch = await this.tryGit(repoRoot, ['rev-parse', '--verify', branch])
      const args = existingBranch
        ? ['worktree', 'add', target, branch]
        : ['worktree', 'add', '-b', branch, target]
      await this.git(repoRoot, args, 120_000)
    } catch (err) {
      this.ctx.bus.emit({
        type: 'GIT_ACTION',
        projectId: project.id,
        agentId,
        level: 'warn',
        message: `Could not create a worktree for "${agent.name}"; falling back to the shared checkout.`,
        data: { error: (err as Error).message }
      })
      return sharedDir
    }

    this.ctx.bus.emit({
      type: 'GIT_ACTION',
      projectId: project.id,
      agentId,
      message: `Created worktree ${branch} for "${agent.name}"`,
      data: { branch, path: target }
    })
    return target
  }

  async mergeWorktree(repoDir: string, branch: string, options: { message?: string } = {}): Promise<string> {
    const root = await this.root(repoDir)
    if (!root) throw new AppError('Not a git repository.', 'NOT_A_REPO')
    try {
      await this.git(root, [
        '-c',
        'user.name=Agent Orchestrator',
        '-c',
        'user.email=agents@localhost',
        'merge',
        '--no-ff',
        branch,
        '-m',
        options.message ?? `Merge ${branch}`
      ], 120_000)
    } catch (err) {
      throw new AppError(
        `Merging ${branch} failed, probably due to a conflict: ${(err as Error).message}`,
        'MERGE_FAILED'
      )
    }
    this.ctx.bus.emit({ type: 'GIT_ACTION', message: `Merged ${branch}`, data: { branch } })
    return `Merged ${branch}.`
  }

  async removeWorktree(repoDir: string, worktreePath: string, force = false): Promise<void> {
    const root = await this.root(repoDir)
    if (!root) throw new AppError('Not a git repository.', 'NOT_A_REPO')
    const args = ['worktree', 'remove', worktreePath]
    if (force) args.push('--force')
    await this.git(root, args, 60_000)
    this.ctx.bus.emit({
      type: 'GIT_ACTION',
      message: `Removed worktree ${path.basename(worktreePath)}`,
      data: { path: worktreePath }
    })
  }

  /** Everything an agent changed in its worktree, against the main branch. */
  async worktreeDiff(repoDir: string, branch: string): Promise<string> {
    const root = await this.root(repoDir)
    if (!root) return ''
    const base =
      (await this.tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? 'HEAD'
    return (await this.tryGit(root, ['diff', '--no-color', `${base}...${branch}`])) ?? ''
  }

  async init(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
    await this.git(dir, ['init'])
    await this.git(dir, ['-c', 'user.name=Agent Orchestrator', '-c', 'user.email=agents@localhost', 'commit', '--allow-empty', '-m', 'Initial commit'])
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}
