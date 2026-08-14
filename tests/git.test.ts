import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, waitFor, type TestApp } from './helpers'
import type { ScriptStep, ScriptTurnContext } from '../src/main/runtime/providers/scripted'

let app: TestApp
let repo: string

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

beforeEach(async () => {
  app = await createTestApp({ startEngines: true, tickMs: 20 })
  repo = path.join(app.tmpDir, 'repo')
  mkdirSync(repo, { recursive: true })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  writeFileSync(path.join(repo, 'README.md'), '# Repo\n')
  git(['add', '-A'])
  git(['commit', '-m', 'initial'])
})

afterEach(async () => {
  await app.dispose()
})

describe('git status and diff', () => {
  it('reads branch and dirty state', async () => {
    const clean = await app.ctx.git.status(repo)
    expect(clean.isRepo).toBe(true)
    expect(clean.branch).toBe('main')
    expect(clean.clean).toBe(true)

    writeFileSync(path.join(repo, 'new.txt'), 'hello\n')
    const dirty = await app.ctx.git.status(repo)
    expect(dirty.clean).toBe(false)
    expect(dirty.entries.some((e) => e.path === 'new.txt' && e.untracked)).toBe(true)
  })

  it('reports a directory that is not a repository without throwing', async () => {
    const plain = path.join(app.tmpDir, 'plain')
    mkdirSync(plain, { recursive: true })
    const status = await app.ctx.git.status(plain)
    expect(status.isRepo).toBe(false)
    expect(status.entries).toEqual([])
  })

  it('shows an untracked file as an addition so new work is reviewable', async () => {
    writeFileSync(path.join(repo, 'fresh.txt'), 'line one\nline two\n')
    const diff = await app.ctx.git.diff(repo, { file: 'fresh.txt' })
    expect(diff).toContain('+line one')
    expect(diff).toContain('+line two')
  })

  it('commits and logs', async () => {
    writeFileSync(path.join(repo, 'work.txt'), 'done\n')
    const head = await app.ctx.git.commit(repo, 'Add work')
    expect(head).toMatch(/^[0-9a-f]{7,}$/)

    const log = await app.ctx.git.log(repo, 5)
    expect(log[0].subject).toBe('Add work')

    const after = await app.ctx.git.status(repo)
    expect(after.clean).toBe(true)
  })

  it('says so plainly when there is nothing to commit', async () => {
    expect(await app.ctx.git.commit(repo, 'Nothing')).toMatch(/nothing to commit/i)
  })
})

describe('worktree isolation', () => {
  it('gives each agent its own branch and directory', async () => {
    const project = app.ctx.projects.create({
      name: 'Isolated',
      rootPath: repo,
      settings: { defaultProvider: 'scripted', isolateAgentWorkspaces: true }
    })
    const alice = app.ctx.agents.create({ projectId: project.id, name: 'Alice' })
    const bob = app.ctx.agents.create({ projectId: project.id, name: 'Bob' })

    const aliceDir = await app.ctx.git.ensureAgentWorkspace(alice.id, repo)
    const bobDir = await app.ctx.git.ensureAgentWorkspace(bob.id, repo)

    expect(aliceDir).not.toBe(repo)
    expect(aliceDir).not.toBe(bobDir)
    expect(existsSync(path.join(aliceDir, 'README.md'))).toBe(true)

    const worktrees = await app.ctx.git.listWorktrees(repo)
    const branches = worktrees.map((w) => w.branch)
    expect(branches).toContain(app.ctx.git.branchNameFor('Alice', alice.id))
    expect(branches).toContain(app.ctx.git.branchNameFor('Bob', bob.id))

    // Asking twice returns the same worktree rather than making another.
    expect(await app.ctx.git.ensureAgentWorkspace(alice.id, repo)).toBe(aliceDir)
  }, 30_000)

  it('leaves the shared checkout alone when isolation is off', async () => {
    const project = app.ctx.projects.create({
      name: 'Shared',
      rootPath: repo,
      settings: { defaultProvider: 'scripted', isolateAgentWorkspaces: false }
    })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Solo' })
    expect(await app.ctx.git.ensureAgentWorkspace(agent.id, repo)).toBe(repo)
  })

  it('falls back to the shared directory when the project is not a repository', async () => {
    const plain = path.join(app.tmpDir, 'not-a-repo')
    mkdirSync(plain, { recursive: true })
    const project = app.ctx.projects.create({
      name: 'Plain',
      rootPath: plain,
      settings: { defaultProvider: 'scripted', isolateAgentWorkspaces: true }
    })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Solo' })
    expect(await app.ctx.git.ensureAgentWorkspace(agent.id, plain)).toBe(plain)
  })

  it('keeps two agents editing the same file from overwriting each other', async () => {
    const project = app.ctx.projects.create({
      name: 'Concurrent',
      rootPath: repo,
      settings: {
        defaultProvider: 'scripted',
        defaultModel: 'scripted-test',
        autoJudge: false,
        isolateAgentWorkspaces: true
      }
    })
    const alice = app.ctx.agents.create({
      projectId: project.id,
      name: 'Alice',
      permissions: ['FILES_READ', 'FILES_WRITE', 'GIT_WRITE'],
      toolkitNames: ['Filesystem', 'Git']
    })
    const bob = app.ctx.agents.create({
      projectId: project.id,
      name: 'Bob',
      permissions: ['FILES_READ', 'FILES_WRITE', 'GIT_WRITE'],
      toolkitNames: ['Filesystem', 'Git']
    })

    // Both agents write to the same path, at the same time, with different content.
    app.scripted.setResponder(async ({ request, turn }: ScriptTurnContext): Promise<ScriptStep[]> => {
      const who = request.agentName
      if (turn === 1) {
        return [
          {
            type: 'tool',
            name: 'write_file',
            input: { path: 'shared.txt', content: `written by ${who}\n` }
          },
          { type: 'tool', name: 'git_commit', input: { message: `${who} edited shared.txt` } }
        ]
      }
      return [
        { type: 'tool', name: 'complete_task', input: { summary: `${who} finished.` } },
        { type: 'end' }
      ]
    })

    const taskA = app.ctx.tasks.create({
      projectId: project.id,
      agentId: alice.id,
      title: 'Alice edits shared.txt',
      requiresJudge: false,
      status: 'READY'
    })
    const taskB = app.ctx.tasks.create({
      projectId: project.id,
      agentId: bob.id,
      title: 'Bob edits shared.txt',
      requiresJudge: false,
      status: 'READY'
    })

    await waitFor(
      () =>
        app.ctx.tasks.get(taskA.id).status === 'COMPLETED' &&
        app.ctx.tasks.get(taskB.id).status === 'COMPLETED',
      { timeoutMs: 30_000, message: 'both agents never finished' }
    )

    const aliceBranch = app.ctx.git.branchNameFor('Alice', alice.id)
    const bobBranch = app.ctx.git.branchNameFor('Bob', bob.id)

    // Each agent's own version survives on its own branch.
    expect(git(['show', `${aliceBranch}:shared.txt`])).toContain('written by Alice')
    expect(git(['show', `${bobBranch}:shared.txt`])).toContain('written by Bob')

    // The shared checkout is untouched: no silent last-writer-wins.
    expect(existsSync(path.join(repo, 'shared.txt'))).toBe(false)

    const diff = await app.ctx.git.worktreeDiff(repo, aliceBranch)
    expect(diff).toContain('written by Alice')
    expect(diff).not.toContain('written by Bob')
  }, 45_000)

  it('merges an agent branch back into the main checkout', async () => {
    const project = app.ctx.projects.create({
      name: 'Mergeable',
      rootPath: repo,
      settings: { defaultProvider: 'scripted', isolateAgentWorkspaces: true }
    })
    const agent = app.ctx.agents.create({ projectId: project.id, name: 'Contributor' })
    const dir = await app.ctx.git.ensureAgentWorkspace(agent.id, repo)

    writeFileSync(path.join(dir, 'feature.txt'), 'the feature\n')
    await app.ctx.git.commit(dir, 'Add the feature')

    const branch = app.ctx.git.branchNameFor('Contributor', agent.id)
    await app.ctx.git.mergeWorktree(repo, branch)

    const merged = path.join(repo, 'feature.txt')
    expect(existsSync(merged)).toBe(true)
    expect(readFileSync(merged, 'utf8')).toBe('the feature\n')
  }, 30_000)
})
