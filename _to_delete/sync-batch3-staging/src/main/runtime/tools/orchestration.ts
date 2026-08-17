import { LimitError } from '../../core/errors'
import type { AgentRole, Permission } from '../../../shared/domain'
import { AGENT_TEMPLATES, TEMPLATE_BY_ID } from '../../../shared/agent-templates'
import { arr, bool, fail, num, obj, ok, str, type ToolDefinition } from './types'

const TOOLKIT = 'Orchestration'

const criteriaSchema = arr(
  'Checkable acceptance criteria. The Judge scores against exactly these.',
  { type: 'string' }
)

export const orchestrationTools: ToolDefinition[] = [
  {
    name: 'create_agent',
    toolkit: TOOLKIT,
    description:
      'Create a new agent as your child. Use this when a sub-problem needs expertise, ' +
      'permissions or a system prompt different from your own. The new agent persists ' +
      'and can be given tasks, invoked, or left idle.',
    requiredPermissions: ['AGENT_CREATE'],
    inputSchema: obj(
      {
        name: str('Short, distinctive name, e.g. "Schema Designer".'),
        role: str(
          'Optional role from list_roles, e.g. "gitmaster". Its standing instructions, toolkits ' +
            'and permissions become the defaults for anything you leave out.'
        ),
        description: str('One sentence on what this agent is for.'),
        system_prompt: str(
          'The agent\'s standing instructions: its expertise, boundaries, and what "done" means for it.'
        ),
        model: str('Optional model override.'),
        permissions: arr('Permissions to grant. Defaults to a read-only set.', { type: 'string' }),
        toolkits: arr('Toolkit names to attach, e.g. ["Filesystem","Knowledge"].', {
          type: 'string'
        })
      },
      ['name']
    ),
    async handler(input, inv) {
      const { ctx, projectId, agentId } = inv
      const limits = ctx.projects.settings(projectId).limits
      if (inv.depth + 1 > limits.maxDepth) {
        return fail(
          `Refused: creating a child here would reach depth ${inv.depth + 1}, past the limit of ${limits.maxDepth}. ` +
            `Do the work yourself or ask a peer agent instead.`
        )
      }

      // A role is a set of defaults from the catalogue, not a branch in the
      // code: everything it supplies can be overridden field by field, and an
      // agent created without one behaves exactly as it always did.
      const roleKey = input.role ? String(input.role).toLowerCase().replace(/\s+/g, '') : ''
      const template = roleKey
        ? (TEMPLATE_BY_ID.get(roleKey) ?? AGENT_TEMPLATES.find((t) => t.role === roleKey))
        : undefined
      if (roleKey && !template) {
        return fail(
          `There is no role called "${input.role}". Call list_roles to see what this fleet can hire, ` +
            'or omit the role and describe the agent yourself.'
        )
      }
      if (template?.singleton && ctx.agents.list(projectId).some((a) => a.role === template.role)) {
        return fail(
          `This project already has a ${template.name}, and there may only be one. Give the work to ` +
            'the existing one instead.'
        )
      }

      const description = input.description ? String(input.description) : (template?.description ?? '')
      const systemPrompt = input.system_prompt
        ? String(input.system_prompt)
        : (template?.systemPrompt ?? '')
      if (!description || !systemPrompt) {
        return fail(
          'An agent needs a description and standing instructions. Supply them, or name a role ' +
            'from list_roles that already has them.'
        )
      }

      try {
        const agent = ctx.agents.create({
          projectId,
          parentAgentId: agentId,
          createdByAgentId: agentId,
          name: String(input.name),
          role: template?.role as AgentRole | undefined,
          description,
          systemPrompt,
          model: input.model ? String(input.model) : undefined,
          permissions: sanitizePermissions(
            (input.permissions as string[]) ?? template?.permissions ?? [],
            ctx.agents.get(agentId).permissions
          ),
          toolkitNames: ((input.toolkits as string[]) ?? template?.toolkits ?? ['Knowledge']).map(
            String
          )
        })
        inv.spawnedAgents.push(agent.id)
        return ok(
          `Created agent "${agent.name}" (${agent.id}) at depth ${agent.depth}. ` +
            `Give it work with delegate_task, or get an answer now with invoke_agent.`,
          { agentId: agent.id, name: agent.name, depth: agent.depth }
        )
      } catch (err) {
        if (err instanceof LimitError) return fail(err.message, err.details)
        throw err
      }
    }
  },

  {
    name: 'invoke_agent',
    toolkit: TOOLKIT,
    description:
      'Call another agent as if it were a tool and wait for its result. Use this when you ' +
      'need its answer before you can continue. The callee runs a full execution with its ' +
      'own tools, and its work is judged like any other task.',
    requiredPermissions: ['AGENT_INVOKE'],
    timeoutMs: 30 * 60_000,
    inputSchema: obj(
      {
        agent: str('Name or id of the agent to invoke.'),
        task: str('What you want it to do. Be specific.'),
        context: str('Optional background it needs.'),
        acceptance_criteria: criteriaSchema,
        judge: bool('Whether the result should be judged before returning. Default false.')
      },
      ['agent', 'task']
    ),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const callee = ctx.agents.resolve(projectId, String(input.agent))
      if (callee.id === inv.agentId) return fail('An agent cannot invoke itself.')

      const limits = ctx.projects.settings(projectId).limits
      if (inv.depth + 1 > limits.maxDepth) {
        return fail(
          `Refused: invoking another agent from depth ${inv.depth} would exceed the depth limit of ${limits.maxDepth}.`
        )
      }

      ctx.agents.link(projectId, inv.agentId, callee.id, 'INVOKES')

      const task = ctx.tasks.create({
        projectId,
        agentId: callee.id,
        createdByAgentId: inv.agentId,
        parentTaskId: inv.taskId,
        title: truncate(String(input.task), 120),
        description: [String(input.task), input.context ? `\nContext:\n${input.context}` : '']
          .join('')
          .trim(),
        acceptanceCriteria: (input.acceptance_criteria as string[]) ?? [],
        requiresJudge: input.judge === true,
        status: 'READY',
        priority: 70
      })

      const result = await ctx.executor.runTaskNow(task.id, {
        parentExecutionId: inv.executionId,
        depth: inv.depth + 1,
        signal: inv.signal
      })

      return ok(
        `${callee.name} → ${result.status}: ${result.summary}` +
          (result.issues.length ? `\nIssues: ${result.issues.join('; ')}` : ''),
        result
      )
    }
  },

  {
    name: 'delegate_task',
    toolkit: TOOLKIT,
    description:
      'Hand a task to another agent without waiting. The task is queued and runs when its ' +
      'dependencies clear. Prefer this over invoke_agent when work can proceed in parallel.',
    requiredPermissions: ['TASK_CREATE'],
    inputSchema: obj(
      {
        agent: str('Name or id of the agent to assign.'),
        title: str('Short task title.'),
        description: str('Full instructions.'),
        acceptance_criteria: criteriaSchema,
        priority: num('0-100, higher runs first. Default 50.'),
        depends_on: arr('Task ids that must complete first.', { type: 'string' })
      },
      ['agent', 'title', 'description']
    ),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const assignee = ctx.agents.resolve(projectId, String(input.agent))
      ctx.agents.link(projectId, inv.agentId, assignee.id, 'DELEGATES_TO')

      const task = ctx.tasks.create({
        projectId,
        agentId: assignee.id,
        createdByAgentId: inv.agentId,
        title: String(input.title),
        description: String(input.description),
        acceptanceCriteria: (input.acceptance_criteria as string[]) ?? [],
        priority: input.priority == null ? 50 : Number(input.priority),
        dependsOn: (input.depends_on as string[]) ?? [],
        status: 'BACKLOG'
      })

      ctx.messages.send({
        projectId,
        fromAgentId: inv.agentId,
        toAgentId: assignee.id,
        taskId: task.id,
        type: 'DELEGATION',
        content: `You have been assigned: ${task.title}`
      })

      return ok(`Delegated "${task.title}" to ${assignee.name} (task ${task.id}).`, {
        taskId: task.id,
        agentId: assignee.id
      })
    }
  },

  {
    name: 'create_task',
    toolkit: TOOLKIT,
    description:
      'Create a task in this project. Leave the agent unset to put it in the backlog for ' +
      'later assignment. Always give acceptance criteria - unjudgeable tasks are worthless.',
    requiredPermissions: ['TASK_CREATE'],
    inputSchema: obj(
      {
        title: str('Short task title.'),
        description: str('Full instructions.'),
        agent: str('Optional agent name or id to assign it to.'),
        acceptance_criteria: criteriaSchema,
        priority: num('0-100, higher runs first.'),
        depends_on: arr('Task ids that must complete first.', { type: 'string' }),
        requires_judge: bool('Whether the Judge must approve the result. Default true.')
      },
      ['title', 'description']
    ),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const assignee = input.agent ? ctx.agents.resolve(projectId, String(input.agent)) : null
      const task = ctx.tasks.create({
        projectId,
        agentId: assignee?.id ?? null,
        createdByAgentId: inv.agentId,
        title: String(input.title),
        description: String(input.description),
        acceptanceCriteria: (input.acceptance_criteria as string[]) ?? [],
        priority: input.priority == null ? 50 : Number(input.priority),
        dependsOn: (input.depends_on as string[]) ?? [],
        requiresJudge: input.requires_judge !== false
      })
      return ok(`Created task "${task.title}" (${task.id}).`, { taskId: task.id })
    }
  },

  {
    name: 'update_task',
    toolkit: TOOLKIT,
    description: 'Change a task: reassign it, reprioritise it, rewrite its criteria, or cancel it.',
    requiredPermissions: ['TASK_UPDATE'],
    inputSchema: obj(
      {
        task_id: str('Task id.'),
        agent: str('Reassign to this agent (name or id).'),
        priority: num('New priority.'),
        description: str('Replacement description.'),
        acceptance_criteria: criteriaSchema,
        cancel: bool('Set true to cancel the task.')
      },
      ['task_id']
    ),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const taskId = String(input.task_id)
      const task = ctx.tasks.get(taskId)
      if (task.projectId !== projectId) return fail('That task belongs to another project.')

      if (input.cancel === true) {
        ctx.tasks.cancel(taskId, `Cancelled by ${ctx.agents.get(inv.agentId).name}`)
        return ok(`Cancelled task "${task.title}".`)
      }
      if (input.agent) ctx.tasks.assign(taskId, ctx.agents.resolve(projectId, String(input.agent)).id)
      const patch: Record<string, unknown> = {}
      if (input.priority != null) patch.priority = Number(input.priority)
      if (input.description) patch.description = String(input.description)
      if (Object.keys(patch).length) ctx.tasks.update(taskId, patch)
      if (input.acceptance_criteria) {
        ctx.tasks.setCriteria(
          taskId,
          (input.acceptance_criteria as string[]).map((text, i) => ({
            id: `AC${i + 1}`,
            text,
            met: null
          }))
        )
      }
      return ok(`Updated task "${task.title}".`)
    }
  },

  {
    name: 'add_task_dependency',
    toolkit: TOOLKIT,
    description: 'Make one task wait for another to complete.',
    requiredPermissions: ['TASK_UPDATE'],
    inputSchema: obj(
      { task_id: str('The task that waits.'), depends_on: str('The task it waits for.') },
      ['task_id', 'depends_on']
    ),
    async handler(input, inv) {
      try {
        inv.ctx.tasks.addDependency(String(input.task_id), String(input.depends_on))
        return ok('Dependency added.')
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    }
  },

  {
    name: 'list_agents',
    toolkit: TOOLKIT,
    description: 'List every agent in this project with status, depth and current workload.',
    requiredPermissions: [],
    inputSchema: obj({}),
    async handler(_input, inv) {
      const rows = inv.ctx.agents.list(inv.projectId).map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        depth: a.depth,
        parent: a.parentAgentId,
        description: a.description,
        openTasks: inv.ctx.tasks
          .listByAgent(a.id)
          .filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status)).length
      }))
      return ok(JSON.stringify(rows, null, 2), rows)
    }
  },

  {
    name: 'list_roles',
    toolkit: TOOLKIT,
    description:
      'List the roles this fleet can hire, and which of them are already staffed in this project. ' +
      'Pass one to create_agent to start from its standing instructions rather than writing them.',
    requiredPermissions: [],
    inputSchema: obj({}),
    async handler(_input, inv) {
      const staffed = new Map<string, string[]>()
      for (const agent of inv.ctx.agents.list(inv.projectId)) {
        staffed.set(agent.role, [...(staffed.get(agent.role) ?? []), agent.name])
      }

      const rows = AGENT_TEMPLATES.map((t) => ({
        role: t.id,
        name: t.name,
        summary: t.summary,
        toolkits: t.toolkits,
        permissions: t.permissions,
        onlyOne: Boolean(t.singleton),
        // Naming who already holds a role is what stops the Orchestrator hiring
        // a second Judge when it could have asked the first one.
        alreadyInThisProject: staffed.get(t.role) ?? []
      }))
      return ok(JSON.stringify(rows, null, 2), rows)
    }
  },

  {
    name: 'inspect_agent',
    toolkit: TOOLKIT,
    description: 'Read one agent in full: prompt, permissions, toolkits, children and task history.',
    requiredPermissions: [],
    inputSchema: obj({ agent: str('Name or id.') }, ['agent']),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const agent = ctx.agents.resolve(projectId, String(input.agent))
      const detail = {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        depth: agent.depth,
        model: agent.model,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        permissions: agent.permissions,
        children: ctx.agents.children(agent.id).map((c) => ({ id: c.id, name: c.name })),
        tasks: ctx.tasks.listByAgent(agent.id).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          score: t.score == null ? null : t.score / 100
        }))
      }
      return ok(JSON.stringify(detail, null, 2), detail)
    }
  },

  {
    name: 'update_agent',
    toolkit: TOOLKIT,
    description:
      'Refine an agent you manage: sharpen its system prompt, change its model, or adjust ' +
      'its description. You cannot grant permissions you do not hold yourself.',
    requiredPermissions: ['AGENT_CREATE'],
    inputSchema: obj(
      {
        agent: str('Name or id.'),
        system_prompt: str('Replacement system prompt.'),
        description: str('Replacement description.'),
        model: str('Replacement model.'),
        permissions: arr('Replacement permission list.', { type: 'string' })
      },
      ['agent']
    ),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const target = ctx.agents.resolve(projectId, String(input.agent))
      if (target.isBuiltIn) return fail('Built-in agents cannot be rewritten by other agents.')
      const patch: Record<string, unknown> = {}
      if (input.system_prompt) patch.systemPrompt = String(input.system_prompt)
      if (input.description) patch.description = String(input.description)
      if (input.model) patch.model = String(input.model)
      if (input.permissions) {
        patch.permissions = sanitizePermissions(
          input.permissions as string[],
          ctx.agents.get(inv.agentId).permissions
        )
      }
      ctx.agents.update(target.id, patch)
      return ok(`Updated agent "${target.name}".`)
    }
  },

  {
    name: 'clone_agent',
    toolkit: TOOLKIT,
    description: 'Duplicate an existing agent, optionally under a new name, to parallelise work.',
    requiredPermissions: ['AGENT_CREATE'],
    inputSchema: obj({ agent: str('Name or id to clone.'), name: str('Name for the copy.') }, [
      'agent'
    ]),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const source = ctx.agents.resolve(projectId, String(input.agent))
      try {
        const clone = ctx.agents.clone(source.id, {
          name: input.name ? String(input.name) : undefined,
          parentAgentId: inv.agentId,
          createdByAgentId: inv.agentId
        })
        inv.spawnedAgents.push(clone.id)
        return ok(`Cloned "${source.name}" as "${clone.name}" (${clone.id}).`, {
          agentId: clone.id
        })
      } catch (err) {
        if (err instanceof LimitError) return fail(err.message)
        throw err
      }
    }
  },

  {
    name: 'pause_agent',
    toolkit: TOOLKIT,
    description: 'Pause an agent so it stops picking up queued work.',
    requiredPermissions: ['AGENT_CREATE'],
    inputSchema: obj({ agent: str('Name or id.') }, ['agent']),
    async handler(input, inv) {
      const target = inv.ctx.agents.resolve(inv.projectId, String(input.agent))
      inv.ctx.agents.setStatus(target.id, 'PAUSED', `Paused by ${inv.ctx.agents.get(inv.agentId).name}`)
      return ok(`Paused "${target.name}".`)
    }
  },

  {
    name: 'resume_agent',
    toolkit: TOOLKIT,
    description: 'Resume a paused agent.',
    requiredPermissions: ['AGENT_CREATE'],
    inputSchema: obj({ agent: str('Name or id.') }, ['agent']),
    async handler(input, inv) {
      const target = inv.ctx.agents.resolve(inv.projectId, String(input.agent))
      inv.ctx.agents.setStatus(target.id, 'IDLE', `Resumed by ${inv.ctx.agents.get(inv.agentId).name}`)
      return ok(`Resumed "${target.name}".`)
    }
  },

  {
    name: 'delete_agent',
    toolkit: TOOLKIT,
    description:
      'Delete an agent and its descendants. Irreversible, and gated by human approval when ' +
      'the project policy says so.',
    requiredPermissions: ['AGENT_DELETE'],
    dangerous: true,
    inputSchema: obj({ agent: str('Name or id.'), reason: str('Why.') }, ['agent', 'reason']),
    async handler(input, inv) {
      const target = inv.ctx.agents.resolve(inv.projectId, String(input.agent))
      if (target.isBuiltIn) return fail('Built-in agents cannot be deleted.')
      const ids = inv.ctx.agents.delete(target.id, true)
      return ok(`Deleted "${target.name}" and ${ids.length - 1} descendants.`)
    }
  },

  {
    name: 'list_tasks',
    toolkit: TOOLKIT,
    description: 'List tasks in this project, optionally filtered by status or agent.',
    requiredPermissions: [],
    inputSchema: obj({
      status: str('Optional status filter, e.g. RUNNING.'),
      agent: str('Optional agent name or id.')
    }),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      let rows = ctx.tasks.list(projectId)
      if (input.agent) {
        const agent = ctx.agents.resolve(projectId, String(input.agent))
        rows = rows.filter((t) => t.agentId === agent.id)
      }
      if (input.status) rows = rows.filter((t) => t.status === String(input.status).toUpperCase())
      const view = rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        agentId: t.agentId,
        score: t.score == null ? null : t.score / 100,
        criteria: t.acceptanceCriteria.length
      }))
      return ok(JSON.stringify(view, null, 2), view)
    }
  },

  {
    name: 'project_status',
    toolkit: TOOLKIT,
    description:
      'The project dashboard as data: agent counts, task counts by status, spend, average ' +
      'judge score and requirement coverage. Read this before deciding what to do next.',
    requiredPermissions: [],
    inputSchema: obj({}),
    async handler(_input, inv) {
      const stats = inv.ctx.projects.stats(inv.projectId)
      const project = inv.ctx.projects.get(inv.projectId)
      const payload = {
        name: project.name,
        mission: project.mission,
        status: project.status,
        acceptanceCriteria: project.acceptanceCriteria,
        ...stats
      }
      return ok(JSON.stringify(payload, null, 2), payload)
    }
  },

  {
    name: 'create_schedule',
    toolkit: TOOLKIT,
    description:
      'Schedule recurring or future work. Supports cron, fixed intervals, a one-off time, or ' +
      'firing on a system event. The schedule survives application restarts.',
    requiredPermissions: ['SCHEDULE_CREATE'],
    inputSchema: obj(
      {
        kind: str('One of: cron, interval, once, event.'),
        cron: str('Cron expression when kind=cron, e.g. "0 9 * * 1".'),
        interval_ms: num('Milliseconds between runs when kind=interval.'),
        run_at: num('Epoch milliseconds when kind=once.'),
        event_type: str('Event name when kind=event, e.g. TASK_FAILED.'),
        agent: str('Agent to assign each generated task to.'),
        title: str('Title of the task each firing creates.'),
        description: str('Instructions for the generated task.'),
        acceptance_criteria: criteriaSchema
      },
      ['kind', 'title', 'description']
    ),
    async handler(input, inv) {
      const { ctx, projectId } = inv
      const assignee = input.agent ? ctx.agents.resolve(projectId, String(input.agent)) : null
      try {
        const schedule = ctx.schedules.create({
          projectId,
          agentId: assignee?.id ?? inv.agentId,
          createdByAgentId: inv.agentId,
          name: String(input.title),
          kind: String(input.kind) as 'cron' | 'interval' | 'once' | 'event',
          cron: input.cron ? String(input.cron) : null,
          intervalMs: input.interval_ms == null ? null : Number(input.interval_ms),
          runAt: input.run_at == null ? null : Number(input.run_at),
          eventType: input.event_type ? String(input.event_type) : null,
          taskTemplate: {
            title: String(input.title),
            description: String(input.description),
            acceptanceCriteria: (input.acceptance_criteria as string[]) ?? [],
            agentId: assignee?.id ?? inv.agentId
          }
        })
        return ok(
          `Schedule created (${schedule.id}). Next run: ${
            schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : 'on event'
          }.`,
          { scheduleId: schedule.id }
        )
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    }
  }
]

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * An agent can never hand out authority it does not have. Requested permissions
 * are intersected with the creator's own.
 */
function sanitizePermissions(requested: string[], creatorHas: Permission[]): Permission[] {
  const wanted = requested.map((p) => p.toUpperCase() as Permission)
  return wanted.filter((p) => creatorHas.includes(p))
}
