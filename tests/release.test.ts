import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, scriptedProject, type TestApp } from './helpers'
import { releaseTools } from '../src/main/runtime/tools/release'
import { orchestrationTools } from '../src/main/runtime/tools/orchestration'
import type { ToolInvocation, ToolResult } from '../src/main/runtime/tools/types'

/**
 * The Release toolkit, driven against a real repository on disk.
 *
 * These tools exist to do the real thing, so the tests do the real thing too:
 * a git repo is initialised, commits are made, and the assertions read the
 * files and the log afterwards. The two tools that need something the machine
 * may not have - the GitHub CLI and an SMTP account - are asserted on their
 * refusal, because refusing honestly is the behaviour that matters.
 */

let app: TestApp
let repo: string
let project: { id: string }
let agentId: string

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function tool(name: string) {
  const found = releaseTools.find((t) => t.name === name)
  if (!found) throw new Error(`no release tool called ${name}`)
  return found
}

/** Calls a tool handler directly, with a workspace pointed at the test repo. */
async function call(name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
  const invocation: ToolInvocation = {
    ctx: app.ctx,
    projectId: project.id,
    agentId,
    taskId: null,
    executionId: 'exec-test',
    depth: 0,
    signal: new AbortController().signal,
    workspaceDir: repo,
    finish: () => undefined,
    spawnedAgents: []
  }
  return tool(name).handler(input, invocation)
}

beforeEach(async () => {
  app = await createTestApp()
  repo = path.join(app.tmpDir, 'repo')
  mkdirSync(repo, { recursive: true })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  writeFileSync(path.join(repo, 'README.md'), '# Repo\n')
  writeFileSync(
    path.join(repo, 'package.json'),
    `${JSON.stringify({ name: 'demo', version: '1.2.3' }, null, 2)}\n`
  )
  git(['add', '-A'])
  git(['commit', '-m', 'chore: initial'])

  project = scriptedProject(app, { workspaceDir: repo })
  agentId = app.ctx.agents.orchestratorFor(project.id)!.id
})

afterEach(async () => {
  await app.dispose()
})

describe('licences', () => {
  it('writes a real MIT licence with the holder and year in it', async () => {
    const result = await call('create_license', { kind: 'mit', holder: 'Acme Ltd', year: '2026' })
    expect(result.ok).toBe(true)

    const text = readFileSync(path.join(repo, 'LICENSE'), 'utf8')
    expect(text).toContain('MIT License')
    expect(text).toContain('Copyright (c) 2026 Acme Ltd')
    expect(text).toContain('WITHOUT WARRANTY OF ANY KIND')
  })

  it('refuses to overwrite a licence that is already there', async () => {
    await call('create_license', { kind: 'mit', holder: 'Acme Ltd' })
    const again = await call('create_license', { kind: 'apache2', holder: 'Someone Else' })

    expect(again.ok).toBe(false)
    expect(again.content).toContain('already exists')
    // The original survived; nothing was silently replaced.
    expect(readFileSync(path.join(repo, 'LICENSE'), 'utf8')).toContain('MIT License')
  })

  it('names the licences it does have when asked for one it does not', async () => {
    const result = await call('create_license', { kind: 'wtfpl', holder: 'Acme Ltd' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('mit')
    expect(result.content).toContain('apache2')
  })
})

describe('versions', () => {
  it('bumps each level and writes package.json back', async () => {
    expect((await call('bump_version', { level: 'patch' })).ok).toBe(true)
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version).toBe('1.2.4')

    await call('bump_version', { level: 'minor' })
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version).toBe('1.3.0')

    await call('bump_version', { level: 'major' })
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version).toBe('2.0.0')
  })

  it('sets an exact version and tolerates a leading v', async () => {
    const result = await call('bump_version', { version: 'v4.5.6' })
    expect(result.ok).toBe(true)
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version).toBe('4.5.6')
  })

  it('rejects a version that is not semantic rather than writing nonsense', async () => {
    const result = await call('bump_version', { version: 'latest' })
    expect(result.ok).toBe(false)
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version).toBe('1.2.3')
  })

  it('keeps the rest of package.json intact', async () => {
    await call('bump_version', { level: 'patch' })
    const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('demo')
  })
})

describe('release notes', () => {
  beforeEach(() => {
    git(['tag', 'v1.0.0'])
    for (const message of [
      'feat: add the thing',
      'fix(core): stop the crash',
      'docs: explain the thing',
      'went off script'
    ]) {
      writeFileSync(path.join(repo, `${message.length}.txt`), `${message}\n`)
      git(['add', '-A'])
      git(['commit', '-m', message])
    }
  })

  it('groups commits by conventional prefix since the last tag', async () => {
    const result = await call('release_notes')
    expect(result.ok).toBe(true)
    expect(result.content).toContain('Changes since v1.0.0')
    expect(result.content).toContain('## Added')
    expect(result.content).toContain('- add the thing')
    expect(result.content).toContain('## Fixed')
    expect(result.content).toContain('- stop the crash')
    expect(result.content).toContain('## Documentation')
    // A commit that follows no convention still appears, under Other.
    expect(result.content).toContain('## Other')
    expect(result.content).toContain('- went off script')
  })

  it('writes the notes to a file when given one', async () => {
    const result = await call('release_notes', { write_to: 'CHANGELOG.md' })
    expect(result.ok).toBe(true)
    const written = readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8')
    expect(written).toContain('# Release notes')
    expect(written).toContain('- add the thing')
  })

  it('will not write outside the workspace', async () => {
    const result = await call('release_notes', { write_to: '../escaped.md' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside the workspace')
    expect(existsSync(path.join(app.tmpDir, 'escaped.md'))).toBe(false)
  })
})

describe('branches and commits', () => {
  it('creates a release branch and checks it out', async () => {
    const result = await call('release_branch', { version: '2.1.0' })
    expect(result.ok).toBe(true)
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('release/2.1.0')
  })

  it('refuses a second branch with the same name instead of failing halfway', async () => {
    await call('release_branch', { version: '2.1.0' })
    git(['checkout', 'main'])
    const again = await call('release_branch', { version: '2.1.0' })
    expect(again.ok).toBe(false)
    expect(again.content).toContain('already exists')
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main')
  })

  it('rejects a branch version that is not semantic', async () => {
    const result = await call('release_branch', { version: 'next' })
    expect(result.ok).toBe(false)
  })

  it('says the tree is clean rather than making an empty commit', async () => {
    const result = await call('commit_and_push', { message: 'nothing to do' })
    expect(result.ok).toBe(true)
    expect(result.content).toContain('clean')
  })

  it('commits the work, then reports the push failure honestly when there is no remote', async () => {
    writeFileSync(path.join(repo, 'work.txt'), 'done\n')
    const result = await call('commit_and_push', { message: 'feat: real work' })

    // The commit is real even though the push could not happen.
    expect(git(['log', '--oneline']).trim()).toContain('feat: real work')
    expect(result.ok).toBe(false)
    expect(result.content).toContain('Committed locally')
  })
})

describe('tools that need something this machine may not have', () => {
  it('refuses to send email with no SMTP account, and shows what it would have sent', async () => {
    const result = await call('send_email', {
      to: 'someone@example.com',
      subject: 'Release 2.0',
      body: 'It shipped.'
    })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('No SMTP account is configured')
    expect(result.content).toContain('someone@example.com')
    expect(result.content).toContain('It shipped.')
  })

  it('reports no configured dev server rather than guessing a command', async () => {
    const result = await call('dev_server', { action: 'start' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('No dev server command is configured')
  })
})

describe('the board', () => {
  it('posts a broadcast every agent can read', async () => {
    const result = await call('message_to_board', { content: 'Release 2.0 is cut.' })
    expect(result.ok).toBe(true)

    const messages = app.ctx.messages.thread(project.id)
    const posted = messages.find((m) => m.content === 'Release 2.0 is cut.')
    expect(posted).toBeTruthy()
    expect(posted!.type).toBe('BROADCAST')
    expect(posted!.toAgentId).toBeNull()
  })

  it('addresses one agent by name, and says so when there is no such agent', async () => {
    const judge = app.ctx.agents.list(project.id).find((a) => a.role === 'judge')!
    const direct = await call('message_to_board', {
      content: 'Please re-check the last verdict.',
      to_agent: judge.name
    })
    expect(direct.ok).toBe(true)
    expect(
      app.ctx.messages.thread(project.id).find((m) => m.toAgentId === judge.id)
    ).toBeTruthy()

    const missing = await call('message_to_board', { content: 'hello', to_agent: 'Nobody' })
    expect(missing.ok).toBe(false)
    expect(missing.content).toContain('Nobody')
  })
})

describe('the toolkit as the runtime sees it', () => {
  it('registers every tool under Release with permissions declared', () => {
    const names = releaseTools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'commit_and_push',
        'release_branch',
        'create_pr',
        'worktree',
        'bump_version',
        'release_notes',
        'create_license',
        'dev_server',
        'open_in_editor',
        'message_to_board',
        'send_email'
      ])
    )
    for (const t of releaseTools) {
      expect(t.toolkit).toBe('Release')
      expect(t.requiredPermissions.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(20)
    }
  })

  it('gates the tools that change the world behind approval', () => {
    const dangerous = releaseTools.filter((t) => t.dangerous).map((t) => t.name).sort()
    expect(dangerous).toEqual(['commit_and_push', 'create_pr', 'send_email'])
  })
})

/**
 * Hiring from the catalogue.
 *
 * The roles are data, not branches: create_agent takes a role name and uses the
 * template's prompt, toolkits and permissions as defaults. Every one of them can
 * still be overridden, and an agent created without a role behaves as it always
 * did - so adding a role never adds a code path.
 */
describe('hiring from the role catalogue', () => {
  function invocation(agentId: string): ToolInvocation {
    return {
      ctx: app.ctx,
      projectId: project.id,
      agentId,
      taskId: null,
      executionId: 'exec-test',
      depth: 0,
      signal: new AbortController().signal,
      workspaceDir: repo,
      finish: () => undefined,
      spawnedAgents: []
    }
  }

  async function orchestrate(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = orchestrationTools.find((t) => t.name === name)!
    return tool.handler(input, invocation(agentId))
  }

  it('lists the roles and says which are already staffed here', async () => {
    const result = await orchestrate('list_roles', {})
    expect(result.ok).toBe(true)
    const rows = JSON.parse(result.content) as Array<{
      role: string
      onlyOne: boolean
      alreadyInThisProject: string[]
    }>

    expect(rows.map((r) => r.role)).toEqual(expect.arrayContaining(['gitmaster', 'emailer', 'judge']))
    // The project ships with an Orchestrator and a Judge, and it should say so
    // rather than letting the fleet hire a second one.
    const judge = rows.find((r) => r.role === 'judge')!
    expect(judge.onlyOne).toBe(true)
    expect(judge.alreadyInThisProject).toEqual(['Judge'])
    expect(rows.find((r) => r.role === 'gitmaster')!.alreadyInThisProject).toEqual([])
  })

  it('takes the standing instructions and toolkits from the role', async () => {
    const result = await orchestrate('create_agent', { name: 'Release Hand', role: 'gitmaster' })
    expect(result.ok).toBe(true)

    const hired = app.ctx.agents.list(project.id).find((a) => a.name === 'Release Hand')!
    expect(hired.role).toBe('gitmaster')
    expect(hired.systemPrompt).toContain('You are the Git Master')
    const tools = app.ctx.tools.toolsForAgent(hired.id).map((t) => t.name)
    expect(tools).toContain('commit_and_push')
    expect(tools).toContain('create_license')
  })

  it('lets the caller override any part of the role', async () => {
    await orchestrate('create_agent', {
      name: 'Notes Only',
      role: 'gitmaster',
      system_prompt: 'You write release notes and nothing else.',
      toolkits: ['Release']
    })
    const hired = app.ctx.agents.list(project.id).find((a) => a.name === 'Notes Only')!
    expect(hired.systemPrompt).toBe('You write release notes and nothing else.')
    expect(app.ctx.tools.toolsForAgent(hired.id).map((t) => t.name)).not.toContain('git_commit')
  })

  it('will not grant a permission the creator does not hold', async () => {
    // The Orchestrator has no FILES_WRITE, so a role that asks for it gets the
    // intersection rather than an escalation.
    await orchestrate('create_agent', { name: 'Bounded Hand', role: 'gitmaster' })
    const hired = app.ctx.agents.list(project.id).find((a) => a.name === 'Bounded Hand')!
    const creator = app.ctx.agents.get(agentId)
    for (const permission of hired.permissions) {
      expect(creator.permissions).toContain(permission)
    }
  })

  it('refuses a role that does not exist instead of inventing one', async () => {
    const result = await orchestrate('create_agent', { name: 'Ghost', role: 'wizard' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('list_roles')
    expect(app.ctx.agents.list(project.id).find((a) => a.name === 'Ghost')).toBeUndefined()
  })

  it('refuses a second Judge and points at the one that exists', async () => {
    const result = await orchestrate('create_agent', { name: 'Judge 2', role: 'judge' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('only be one')
  })

  it('still requires a description and prompt when no role is named', async () => {
    const result = await orchestrate('create_agent', { name: 'Nameless' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('description and standing instructions')
  })
})
