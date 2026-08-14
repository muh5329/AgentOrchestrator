import { arr, bool, fail, obj, ok, str, type ToolDefinition } from './types'

/**
 * Tools that let an agent drive the automation layer: run a saved workflow, and
 * work with git the same way a person would.
 */
export const workflowTools: ToolDefinition[] = [
  {
    name: 'list_workflows',
    toolkit: 'Automation',
    description: 'List the saved workflows for this project and what triggers them.',
    requiredPermissions: [],
    inputSchema: obj({}),
    async handler(_input, inv) {
      const rows = inv.ctx.workflows.list(inv.projectId).map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        trigger: w.trigger,
        eventType: w.eventType,
        enabled: w.enabled
      }))
      return ok(rows.length ? JSON.stringify(rows, null, 2) : 'No workflows are defined.', rows)
    }
  },

  {
    name: 'run_workflow',
    toolkit: 'Automation',
    description:
      'Run a saved workflow and wait for it to finish. Use this to reuse an ' +
      'established multi-step procedure instead of re-deriving it.',
    requiredPermissions: ['TASK_CREATE'],
    timeoutMs: 60 * 60_000,
    inputSchema: obj(
      {
        workflow: str('Workflow name or id.'),
        variables: obj({}, [])
      },
      ['workflow']
    ),
    async handler(input, inv) {
      const name = String(input.workflow)
      const workflow =
        inv.ctx.workflows.list(inv.projectId).find((w) => w.id === name || w.name === name)
      if (!workflow) return fail(`No workflow called "${name}" in this project.`)

      const result = await inv.ctx.workflowEngine.run(workflow.id, {
        trigger: `agent:${inv.agentId}`,
        variables: (input.variables as Record<string, unknown>) ?? {},
        signal: inv.signal,
        callerAgentId: inv.agentId
      })

      const body =
        `Workflow "${workflow.name}" ${result.status.toLowerCase()} after ${result.steps} steps.` +
        (result.error ? `\nError: ${result.error}` : '') +
        `\nContext: ${JSON.stringify(result.context).slice(0, 2000)}`
      return result.status === 'COMPLETED' ? ok(body, result) : fail(body, result)
    }
  }
]

export const gitTools: ToolDefinition[] = [
  {
    name: 'git_status',
    toolkit: 'Git',
    description: 'Show the working tree status of your workspace.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj({}),
    async handler(_input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const status = await inv.ctx.git.status(inv.workspaceDir)
      if (!status.isRepo) return ok('This workspace is not a git repository.')
      const body =
        `On branch ${status.branch}${status.ahead ? ` (ahead ${status.ahead})` : ''}\n` +
        (status.clean
          ? 'Working tree clean.'
          : status.entries.map((e) => `${e.index}${e.worktree} ${e.path}`).join('\n'))
      return ok(body, status)
    }
  },

  {
    name: 'git_diff',
    toolkit: 'Git',
    description: 'Show what changed in your workspace, optionally for one file.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj({ file: str('Optional path to limit the diff to.'), staged: bool('Show staged changes.') }),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const diff = await inv.ctx.git.diff(inv.workspaceDir, {
        file: input.file ? String(input.file) : undefined,
        staged: input.staged === true
      })
      return ok(diff.trim() ? diff.slice(0, 60_000) : 'No changes.')
    }
  },

  {
    name: 'git_commit',
    toolkit: 'Git',
    description:
      'Stage everything in your workspace and commit it. Write a message that ' +
      'says why, not just what.',
    requiredPermissions: ['GIT_WRITE'],
    inputSchema: obj({ message: str('Commit message.') }, ['message']),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      try {
        const head = await inv.ctx.git.commit(inv.workspaceDir, String(input.message))
        inv.ctx.artifacts.create({
          projectId: inv.projectId,
          taskId: inv.taskId,
          executionId: inv.executionId,
          agentId: inv.agentId,
          kind: 'commit',
          title: String(input.message).split('\n')[0],
          meta: { head }
        })
        return ok(`Committed ${head}.`)
      } catch (err) {
        return fail((err as Error).message)
      }
    }
  },

  {
    name: 'git_log',
    toolkit: 'Git',
    description: 'Show recent commits in your workspace.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj({}),
    async handler(_input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const log = await inv.ctx.git.log(inv.workspaceDir, 20)
      if (!log.length) return ok('No commits yet.')
      return ok(log.map((c) => `${c.hash} ${c.date} ${c.author}: ${c.subject}`).join('\n'), log)
    }
  },

  {
    name: 'list_worktrees',
    toolkit: 'Git',
    description: 'List the isolated worktrees agents are working in.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj({}),
    async handler(_input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      const trees = await inv.ctx.git.listWorktrees(inv.workspaceDir)
      if (!trees.length) return ok('No worktrees; every agent shares one checkout.')
      return ok(trees.map((w) => `${w.branch ?? '(detached)'} → ${w.path}`).join('\n'), trees)
    }
  },

  {
    name: 'merge_worktree',
    toolkit: 'Git',
    description:
      "Merge another agent's branch into your workspace. Fails loudly on " +
      'conflict rather than guessing which side is right.',
    requiredPermissions: ['GIT_WRITE'],
    dangerous: true,
    inputSchema: obj({ branch: str('Branch to merge.'), message: str('Merge commit message.') }, ['branch']),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      try {
        const result = await inv.ctx.git.mergeWorktree(inv.workspaceDir, String(input.branch), {
          message: input.message ? String(input.message) : undefined
        })
        return ok(result)
      } catch (err) {
        return fail((err as Error).message)
      }
    }
  },

  {
    name: 'run_tests_and_report',
    toolkit: 'Git',
    description:
      'Run the project test command and record the outcome as an artifact the ' +
      'Judge will read. Prefer this over claiming that tests pass.',
    requiredPermissions: ['SHELL_EXECUTE'],
    timeoutMs: 15 * 60_000,
    inputSchema: obj({ command: str('Test command. Default "npm test".'), paths: arr('Unused.', { type: 'string' }) }),
    async handler(input, inv) {
      const runTests = (await import('./execution')).executionTools.find((t) => t.name === 'run_tests')
      if (!runTests) return fail('The test runner is unavailable.')
      return runTests.handler({ command: input.command }, inv)
    }
  }
]
