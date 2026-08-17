import { promises as fs } from 'node:fs'
import path from 'node:path'
import { runShell } from './execution'
import { fail, ok, type ToolDefinition } from './types'

/**
 * The shipping toolkit.
 *
 * Everything a fleet needs to turn finished work into a release: branches,
 * commits, pull requests, versions, notes, licences. These are the operations a
 * Git Master or a Release agent performs, and every one of them does the real
 * thing - there is no tool here that pretends.
 *
 * Where a tool depends on something the machine may not have (the GitHub CLI, an
 * editor, an SMTP account) it says so plainly and tells you how to fix it,
 * rather than reporting a success nothing happened for.
 */

const obj = (
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> => ({ type: 'object', properties, required })

const str = (description: string): Record<string, unknown> => ({ type: 'string', description })

/** A short, safe run of a shell command inside the agent's workspace. */
async function sh(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 120_000
): Promise<{ ok: boolean; out: string }> {
  const result = await runShell(command, cwd, timeoutMs, signal)
  const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  return { ok: result.code === 0, out }
}

/** Reads the workspace's package.json, if it has one. */
async function readPackage(
  cwd: string
): Promise<{ path: string; json: Record<string, unknown> } | null> {
  const file = path.join(cwd, 'package.json')
  try {
    return { path: file, json: JSON.parse(await fs.readFile(file, 'utf8')) }
  } catch {
    return null
  }
}

const LICENCES: Record<string, (year: string, holder: string) => string> = {
  mit: (year, holder) =>
    `MIT License\n\nCopyright (c) ${year} ${holder}\n\n` +
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this ' +
    'software and associated documentation files (the "Software"), to deal in the Software ' +
    'without restriction, including without limitation the rights to use, copy, modify, merge, ' +
    'publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons ' +
    'to whom the Software is furnished to do so, subject to the following conditions:\n\n' +
    'The above copyright notice and this permission notice shall be included in all copies or ' +
    'substantial portions of the Software.\n\n' +
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, ' +
    'INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR ' +
    'PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE ' +
    'FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR ' +
    'OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER ' +
    'DEALINGS IN THE SOFTWARE.\n',
  apache2: (year, holder) =>
    `Copyright ${year} ${holder}\n\n` +
    'Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file ' +
    'except in compliance with the License. You may obtain a copy of the License at\n\n' +
    '    http://www.apache.org/licenses/LICENSE-2.0\n\n' +
    'Unless required by applicable law or agreed to in writing, software distributed under the ' +
    'License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, ' +
    'either express or implied. See the License for the specific language governing permissions ' +
    'and limitations under the License.\n',
  bsd3: (year, holder) =>
    `BSD 3-Clause License\n\nCopyright (c) ${year}, ${holder}\n\n` +
    'Redistribution and use in source and binary forms, with or without modification, are ' +
    'permitted provided that the following conditions are met:\n\n' +
    '1. Redistributions of source code must retain the above copyright notice, this list of ' +
    'conditions and the following disclaimer.\n\n' +
    '2. Redistributions in binary form must reproduce the above copyright notice, this list of ' +
    'conditions and the following disclaimer in the documentation and/or other materials ' +
    'provided with the distribution.\n\n' +
    '3. Neither the name of the copyright holder nor the names of its contributors may be used ' +
    'to endorse or promote products derived from this software without specific prior written ' +
    'permission.\n\n' +
    'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY ' +
    'EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.\n',
  unlicense: () =>
    'This is free and unencumbered software released into the public domain.\n\n' +
    'Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, ' +
    'either in source code form or as a compiled binary, for any purpose, commercial or ' +
    'non-commercial, and by any means.\n'
}

export const releaseTools: ToolDefinition[] = [
  /* ---------------------------------------------------------------- */
  /* Branches and commits                                              */
  /* ---------------------------------------------------------------- */
  {
    name: 'commit_and_push',
    toolkit: 'Release',
    description:
      'Stage everything in your workspace, commit it, and push the branch to its remote. ' +
      'Sets the upstream on first push.',
    requiredPermissions: ['GIT_WRITE', 'SHELL_EXECUTE'],
    dangerous: true,
    inputSchema: obj(
      {
        message: str('Commit message. Say why, not what - the diff already says what.'),
        remote: str('Remote name. Defaults to origin.')
      },
      ['message']
    ),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const remote = String(input.remote ?? 'origin')

      const status = await sh('git status --porcelain', inv.workspaceDir, inv.signal)
      if (!status.out.trim()) return ok('Nothing to commit; the working tree is clean.')

      const message = String(input.message).replace(/"/g, '\\"')
      const commit = await sh(
        `git add -A && git commit -m "${message}"`,
        inv.workspaceDir,
        inv.signal
      )
      if (!commit.ok) return fail(`Commit failed:\n${commit.out}`)

      const branch = await sh('git rev-parse --abbrev-ref HEAD', inv.workspaceDir, inv.signal)
      const name = branch.out.trim() || 'HEAD'
      const push = await sh(
        `git push --set-upstream ${remote} ${name}`,
        inv.workspaceDir,
        inv.signal,
        180_000
      )
      if (!push.ok) {
        return fail(
          `Committed locally, but the push failed:\n${push.out}\n\n` +
            'If this repository has no remote, add one first. If it needs credentials, this ' +
            'process has none - use an SSH agent or a credential helper.'
        )
      }

      inv.ctx.artifacts.create({
        projectId: inv.projectId,
        taskId: inv.taskId,
        executionId: inv.executionId,
        agentId: inv.agentId,
        kind: 'commit',
        title: String(input.message).split('\n')[0],
        meta: { branch: name, remote }
      })
      return ok(`Committed and pushed ${name} to ${remote}.\n${commit.out}`)
    }
  },

  {
    name: 'release_branch',
    toolkit: 'Release',
    description:
      'Create and check out a release branch from the current HEAD, named release/<version>.',
    requiredPermissions: ['GIT_WRITE', 'SHELL_EXECUTE'],
    inputSchema: obj({ version: str('Version for the branch, e.g. 1.4.0.') }, ['version']),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const version = String(input.version).trim().replace(/^v/, '')
      if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
        return fail(`"${version}" is not a semantic version like 1.4.0.`)
      }
      const branch = `release/${version}`
      const exists = await sh(
        `git rev-parse --verify ${branch}`,
        inv.workspaceDir,
        inv.signal
      )
      if (exists.ok) return fail(`Branch ${branch} already exists.`)

      const result = await sh(`git checkout -b ${branch}`, inv.workspaceDir, inv.signal)
      if (!result.ok) return fail(`Could not create ${branch}:\n${result.out}`)
      return ok(`Created and checked out ${branch}.`)
    }
  },

  {
    name: 'create_pr',
    toolkit: 'Release',
    description:
      'Open a pull request for the current branch using the GitHub CLI. Pushes the branch first ' +
      'if it has no upstream.',
    requiredPermissions: ['GIT_WRITE', 'SHELL_EXECUTE', 'NETWORK_ACCESS'],
    dangerous: true,
    inputSchema: obj(
      {
        title: str('Pull request title.'),
        body: str('Pull request body. Say what changed and why it is safe.'),
        base: str('Base branch. Defaults to the repository default.'),
        draft: { type: 'boolean', description: 'Open as a draft.' }
      },
      ['title']
    ),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')

      const has = await sh('command -v gh', inv.workspaceDir, inv.signal, 15_000)
      if (!has.ok) {
        // Say what is missing and what to do, rather than reporting a success
        // that produced no pull request.
        const branch = await sh('git rev-parse --abbrev-ref HEAD', inv.workspaceDir, inv.signal)
        const remote = await sh('git remote get-url origin', inv.workspaceDir, inv.signal)
        return fail(
          'The GitHub CLI ("gh") is not installed, so no pull request was opened.\n' +
            'Install it and run "gh auth login", or open one by hand for branch ' +
            `"${branch.out.trim()}" on ${remote.out.trim() || 'the remote'}.`
        )
      }

      const branch = (await sh('git rev-parse --abbrev-ref HEAD', inv.workspaceDir, inv.signal)).out.trim()
      const upstream = await sh(
        'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
        inv.workspaceDir,
        inv.signal
      )
      if (!upstream.ok) {
        const push = await sh(
          `git push --set-upstream origin ${branch}`,
          inv.workspaceDir,
          inv.signal,
          180_000
        )
        if (!push.ok) return fail(`Could not push ${branch}:\n${push.out}`)
      }

      const args = [
        'gh pr create',
        `--title ${JSON.stringify(String(input.title))}`,
        `--body ${JSON.stringify(String(input.body ?? ''))}`
      ]
      if (input.base) args.push(`--base ${JSON.stringify(String(input.base))}`)
      if (input.draft) args.push('--draft')

      const result = await sh(args.join(' '), inv.workspaceDir, inv.signal, 180_000)
      if (!result.ok) return fail(`gh pr create failed:\n${result.out}`)

      const url = result.out.match(/https?:\/\/\S+/)?.[0] ?? ''
      inv.ctx.artifacts.create({
        projectId: inv.projectId,
        taskId: inv.taskId,
        executionId: inv.executionId,
        agentId: inv.agentId,
        kind: 'pull-request',
        title: String(input.title),
        meta: { url, branch }
      })
      return ok(`Opened a pull request${url ? `: ${url}` : ''}.`)
    }
  },

  {
    name: 'worktree',
    toolkit: 'Release',
    description:
      'List the agent worktrees in this project, or merge one back into the main checkout.',
    requiredPermissions: ['GIT_WRITE'],
    inputSchema: obj({
      action: {
        type: 'string',
        enum: ['list', 'merge'],
        description: 'What to do. Defaults to list.'
      },
      branch: str('Branch to merge, when action is merge.'),
      message: str('Merge commit message.')
    }),
    async handler(input, inv) {
      const action = String(input.action ?? 'list')
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const repo = await inv.ctx.git.root(inv.workspaceDir)
      if (!repo) return fail('This workspace is not a git repository.')

      if (action === 'list') {
        const trees = await inv.ctx.git.listWorktrees(repo)
        if (!trees.length) return ok('No worktrees. This project shares one checkout.')
        return ok(
          trees
            .map((t) => {
              const owner = t.agentId
                ? (inv.ctx.agents.find(t.agentId)?.name ?? 'an agent')
                : 'shared'
              return `${t.isMain ? '*' : ' '} ${t.branch ?? '(detached)'} — ${owner} — ${t.path}`
            })
            .join('\n')
        )
      }

      if (!input.branch) return fail('Merging needs a branch name.')
      try {
        const message = await inv.ctx.git.mergeWorktree(repo, String(input.branch), {
          message: input.message ? String(input.message) : undefined
        })
        return ok(message)
      } catch (err) {
        return fail((err as Error).message)
      }
    }
  },

  /* ---------------------------------------------------------------- */
  /* Versions, notes and licences                                      */
  /* ---------------------------------------------------------------- */
  {
    name: 'bump_version',
    toolkit: 'Release',
    description:
      'Raise the version in package.json by major, minor or patch, or set it outright.',
    requiredPermissions: ['FILES_WRITE'],
    inputSchema: obj({
      level: {
        type: 'string',
        enum: ['major', 'minor', 'patch'],
        description: 'How much to raise it by.'
      },
      version: str('An exact version to set instead, e.g. 2.0.0.')
    }),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const pkg = await readPackage(inv.workspaceDir)
      if (!pkg) return fail('No package.json in this workspace.')

      const current = String(pkg.json.version ?? '0.0.0')
      let next: string

      if (input.version) {
        next = String(input.version).trim().replace(/^v/, '')
      } else {
        const parts = current.split('.').map((n) => Number.parseInt(n, 10))
        if (parts.length !== 3 || parts.some(Number.isNaN)) {
          return fail(`Cannot bump "${current}" - it is not a three-part semantic version.`)
        }
        const [major, minor, patch] = parts
        const level = String(input.level ?? 'patch')
        next =
          level === 'major'
            ? `${major + 1}.0.0`
            : level === 'minor'
              ? `${major}.${minor + 1}.0`
              : `${major}.${minor}.${patch + 1}`
      }

      if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
        return fail(`"${next}" is not a semantic version like 1.4.0.`)
      }

      pkg.json.version = next
      await fs.writeFile(pkg.path, `${JSON.stringify(pkg.json, null, 2)}\n`, 'utf8')
      return ok(`Version raised from ${current} to ${next} in package.json.`)
    }
  },

  {
    name: 'release_notes',
    toolkit: 'Release',
    description:
      'Draft release notes from the commits since a tag or ref, grouped by conventional-commit ' +
      'prefix. Writes them to a file when given a path.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj({
      since: str('Tag or ref to start from. Defaults to the most recent tag.'),
      write_to: str('Optional path to write the notes to, e.g. CHANGELOG.md.')
    }),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')

      let since = input.since ? String(input.since) : ''
      if (!since) {
        const tag = await sh('git describe --tags --abbrev=0', inv.workspaceDir, inv.signal)
        since = tag.ok ? tag.out.trim() : ''
      }

      const range = since ? `${since}..HEAD` : 'HEAD'
      const log = await sh(
        `git log ${range} --no-merges --pretty=format:%s`,
        inv.workspaceDir,
        inv.signal
      )
      if (!log.ok) return fail(`Could not read the log:\n${log.out}`)

      const subjects = log.out.split('\n').map((l) => l.trim()).filter(Boolean)
      if (!subjects.length) return ok(`No commits since ${since || 'the beginning'}.`)

      // Conventional-commit prefixes when present, "Other" when not - grouping
      // is a convenience, not a requirement the repository has to have met.
      const groups: Record<string, string[]> = {}
      const titles: Record<string, string> = {
        feat: 'Added',
        fix: 'Fixed',
        perf: 'Performance',
        refactor: 'Changed',
        docs: 'Documentation',
        test: 'Tests',
        build: 'Build',
        ci: 'CI',
        chore: 'Housekeeping'
      }
      for (const subject of subjects) {
        const match = subject.match(/^(\w+)(\([^)]*\))?!?:\s*(.+)$/)
        const key = match && titles[match[1]] ? titles[match[1]] : 'Other'
        const text = match && titles[match[1]] ? match[3] : subject
        groups[key] = groups[key] ?? []
        groups[key].push(text)
      }

      const order = ['Added', 'Fixed', 'Performance', 'Changed', 'Documentation', 'Tests', 'Build', 'CI', 'Housekeeping', 'Other']
      const notes = [
        `# Release notes`,
        '',
        since ? `Changes since ${since}.` : 'All changes to date.',
        '',
        ...order
          .filter((key) => groups[key]?.length)
          .flatMap((key) => [`## ${key}`, '', ...groups[key].map((line) => `- ${line}`), ''])
      ].join('\n')

      if (input.write_to) {
        const target = path.resolve(inv.workspaceDir, String(input.write_to))
        if (!target.startsWith(path.resolve(inv.workspaceDir))) {
          return fail('That path is outside the workspace.')
        }
        await fs.writeFile(target, notes, 'utf8')
        return ok(`Wrote ${subjects.length} change${subjects.length === 1 ? '' : 's'} to ${input.write_to}.\n\n${notes}`)
      }
      return ok(notes)
    }
  },

  {
    name: 'create_license',
    toolkit: 'Release',
    description: 'Write a LICENSE file into the workspace.',
    requiredPermissions: ['FILES_WRITE'],
    inputSchema: obj(
      {
        kind: {
          type: 'string',
          enum: ['mit', 'apache2', 'bsd3', 'unlicense'],
          description: 'Which licence.'
        },
        holder: str('Copyright holder.'),
        year: str('Copyright year. Defaults to this year.')
      },
      ['kind', 'holder']
    ),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const kind = String(input.kind).toLowerCase()
      const template = LICENCES[kind]
      if (!template) {
        return fail(`No template for "${kind}". Available: ${Object.keys(LICENCES).join(', ')}.`)
      }

      const target = path.join(inv.workspaceDir, 'LICENSE')
      try {
        await fs.access(target)
        return fail('A LICENSE file already exists. Delete it first if you mean to replace it.')
      } catch {
        // Absent, which is what we want.
      }

      const year = String(input.year ?? new Date().getFullYear())
      await fs.writeFile(target, template(year, String(input.holder)), 'utf8')
      return ok(`Wrote a ${kind.toUpperCase()} LICENSE for ${input.holder} (${year}).`)
    }
  },

  /* ---------------------------------------------------------------- */
  /* The developer's own machine                                       */
  /* ---------------------------------------------------------------- */
  {
    name: 'dev_server',
    toolkit: 'Release',
    description:
      'Start, stop or check the project dev server. The command comes from the project settings, ' +
      'so this tool never guesses what your project runs.',
    requiredPermissions: ['SHELL_EXECUTE'],
    inputSchema: obj({
      action: {
        type: 'string',
        enum: ['start', 'stop', 'status'],
        description: 'What to do. Defaults to status.'
      }
    }),
    async handler(input, inv) {
      const settings = inv.ctx.projects.settings(inv.projectId)
      const command = settings.devServerCommand?.trim()
      const action = String(input.action ?? 'status')

      if (action === 'status') {
        const sessions = inv.ctx.workspace.listSessions().filter((s) => s.running)
        const dev = sessions.find((s) => s.command === command)
        return ok(
          command
            ? dev
              ? `Running since ${new Date(dev.startedAt).toLocaleTimeString()}: ${command}`
              : `Not running. The configured command is: ${command}`
            : 'No dev server command is configured for this project. Set one in Settings.'
        )
      }

      if (!command) {
        return fail(
          'No dev server command is configured for this project. Set "Dev server command" in ' +
            'Settings so this tool knows what to run.'
        )
      }

      if (action === 'stop') {
        const dev = inv.ctx.workspace.listSessions().find((s) => s.running && s.command === command)
        if (!dev) return ok('The dev server is not running.')
        inv.ctx.workspace.killCommand(dev.id)
        return ok('Stopped the dev server.')
      }

      const already = inv.ctx.workspace
        .listSessions()
        .find((s) => s.running && s.command === command)
      if (already) return ok('The dev server is already running.')

      // Started detached: a dev server is meant to outlive the turn that
      // started it, so this deliberately does not wait for it to exit.
      const session = await inv.ctx.workspace.runCommand({
        projectId: inv.projectId,
        agentId: inv.agentId,
        command
      })
      return ok(`Started the dev server: ${command} (session ${session.id}).`)
    }
  },

  {
    name: 'open_in_editor',
    toolkit: 'Release',
    description:
      'Open the workspace, or one file in it, in the desktop editor. Uses the editor command from ' +
      'the project settings, or the platform default.',
    requiredPermissions: ['SHELL_EXECUTE'],
    inputSchema: obj({ path: str('A path inside the workspace. Defaults to the workspace root.') }),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')

      const target = input.path
        ? path.resolve(inv.workspaceDir, String(input.path))
        : inv.workspaceDir
      if (!target.startsWith(path.resolve(inv.workspaceDir))) {
        return fail('That path is outside the workspace.')
      }

      const settings = inv.ctx.projects.settings(inv.projectId)
      const configured = settings.editorCommand?.trim()
      const fallback = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
      const editor = configured || fallback

      const result = await sh(`${editor} ${JSON.stringify(target)}`, inv.workspaceDir, inv.signal, 20_000)
      if (!result.ok) {
        return fail(
          `Could not open it with "${editor}":\n${result.out}\n\n` +
            'Set "Editor command" in Settings to something on this machine, e.g. "code".'
        )
      }
      return ok(`Opened ${path.relative(inv.workspaceDir, target) || '.'} with ${editor}.`)
    }
  },

  /* ---------------------------------------------------------------- */
  /* Talking to people                                                 */
  /* ---------------------------------------------------------------- */
  {
    name: 'message_to_board',
    toolkit: 'Release',
    description:
      'Post to the project message board, where every agent and the human can read it.',
    requiredPermissions: ['AGENT_MESSAGE'],
    inputSchema: obj(
      {
        content: str('What to post. Lead with the consequence, not the chronology.'),
        to_agent: str('Name of one agent to address it to. Omit to post to everyone.')
      },
      ['content']
    ),
    async handler(input, inv) {
      let toAgentId: string | null = null
      if (input.to_agent) {
        const match = inv.ctx.agents
          .list(inv.projectId)
          .find((a) => a.name.toLowerCase() === String(input.to_agent).toLowerCase())
        if (!match) return fail(`No agent called "${input.to_agent}" in this project.`)
        toAgentId = match.id
      }

      inv.ctx.messages.send({
        projectId: inv.projectId,
        fromAgentId: inv.agentId,
        toAgentId,
        taskId: inv.taskId,
        type: toAgentId ? 'MESSAGE' : 'BROADCAST',
        content: String(input.content)
      })
      return ok(toAgentId ? `Posted to ${input.to_agent}.` : 'Posted to the board.')
    }
  },

  {
    name: 'send_email',
    toolkit: 'Release',
    description:
      'Send an email. Requires an SMTP account configured in Settings; without one this refuses ' +
      'rather than pretending to send.',
    requiredPermissions: ['EXTERNAL_API', 'NETWORK_ACCESS'],
    dangerous: true,
    inputSchema: obj(
      {
        to: str('Recipient address.'),
        subject: str('Subject line.'),
        body: str('Plain text body.')
      },
      ['to', 'subject', 'body']
    ),
    async handler(input, inv) {
      const config = await inv.ctx.mail.config()
      if (!config.configured) {
        return fail(
          'No SMTP account is configured, so nothing was sent. Add one under ' +
            'Settings → Email (host, port, user, password, from address), then try again.\n\n' +
            `The message that would have been sent:\nTo: ${input.to}\n` +
            `Subject: ${input.subject}\n\n${String(input.body).slice(0, 400)}`
        )
      }

      try {
        const result = await inv.ctx.mail.send({
          to: String(input.to),
          subject: String(input.subject),
          body: String(input.body)
        })
        inv.ctx.artifacts.create({
          projectId: inv.projectId,
          taskId: inv.taskId,
          executionId: inv.executionId,
          agentId: inv.agentId,
          kind: 'email',
          title: String(input.subject),
          meta: { to: input.to, messageId: result.messageId }
        })
        return ok(`Sent to ${input.to}.`)
      } catch (err) {
        return fail(`The send failed: ${(err as Error).message}`)
      }
    }
  }
]
