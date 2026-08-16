import { desc, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { events as eventsTable, executions as executionsTable } from '../db/schema'
import type { AgentStatus, Permission, TaskStatus } from '../../shared/domain'

type Payload = Record<string, any>

/**
 * The entire renderer-facing surface.
 *
 * The renderer has no Node access and no direct database handle; it can only
 * call these named methods across a single validated IPC channel.
 */
export function createApi(ctx: AppContext): Record<string, (payload: Payload) => unknown> {
  return {
    /* ----------------------------- projects ---------------------------- */
    'projects.list': () => ctx.projects.list(),
    'projects.get': (p) => ctx.projects.get(p.projectId),
    'projects.create': (p) => ctx.projects.create(p as never),
    'projects.createFromMission': (p) => ctx.orchestrator.createFromMission(p as never),
    'projects.update': (p) => ctx.projects.update(p.projectId, p.patch),
    'projects.delete': (p) => {
      ctx.projects.delete(p.projectId)
      return { ok: true }
    },
    'projects.archive': (p) => {
      ctx.projects.archive(p.projectId)
      return { ok: true }
    },
    'projects.stats': (p) => ctx.projects.stats(p.projectId),
    'projects.launch': (p) => ctx.orchestrator.launch(p.projectId),
    'projects.pause': (p) => {
      ctx.orchestrator.pause(p.projectId)
      return { ok: true }
    },
    'projects.resume': (p) => {
      ctx.orchestrator.resume(p.projectId)
      return { ok: true }
    },
    'projects.templates': () => ctx.orchestrator.templates(),

    /* ------------------------------- fleet ----------------------------- */
    'fleet.overview': () => ctx.fleet.overview(),

    /* ------------------------------ agents ----------------------------- */
    'agents.list': (p) => ctx.agents.list(p.projectId),
    'agents.get': (p) => ctx.agents.get(p.agentId),
    'agents.create': (p) => ctx.agents.create(p as never),
    'agents.update': (p) => ctx.agents.update(p.agentId, p.patch),
    'agents.delete': (p) => ctx.agents.delete(p.agentId, p.cascade !== false),
    'agents.clone': (p) => ctx.agents.clone(p.agentId, p.overrides ?? {}),
    'agents.setStatus': (p) => ctx.agents.setStatus(p.agentId, p.status as AgentStatus),
    'agents.graph': (p) => ctx.agents.graph(p.projectId),
    'agents.toolkits': (p) => ctx.agents.toolkitIds(p.agentId),
    'agents.setToolkits': (p) => {
      ctx.agents.setToolkits(p.agentId, p.toolkitIds ?? [])
      return { ok: true }
    },
    'agents.grant': (p) => ctx.agents.grant(p.agentId, p.permissions as Permission[]),
    'agents.revoke': (p) => ctx.agents.revoke(p.agentId, p.permissions as Permission[]),
    'agents.link': (p) => {
      ctx.agents.link(p.projectId, p.fromAgentId, p.toAgentId, p.kind)
      return { ok: true }
    },
    'agents.unlink': (p) => {
      ctx.agents.unlink(p.fromAgentId, p.toAgentId, p.kind)
      return { ok: true }
    },

    /* ------------------------------ tasks ------------------------------ */
    'tasks.list': (p) => ctx.tasks.list(p.projectId),
    'tasks.get': (p) => ctx.tasks.get(p.taskId),
    'tasks.byAgent': (p) => ctx.tasks.listByAgent(p.agentId),
    'tasks.create': (p) => ctx.tasks.create(p as never),
    'tasks.update': (p) => ctx.tasks.update(p.taskId, p.patch),
    'tasks.assign': (p) => ctx.tasks.assign(p.taskId, p.agentId),
    'tasks.setStatus': (p) => ctx.tasks.setStatus(p.taskId, p.status as TaskStatus),
    'tasks.cancel': (p) => ctx.tasks.cancel(p.taskId, p.reason),
    'tasks.run': (p) => {
      ctx.executor.enqueue(p.taskId)
      return { ok: true }
    },
    'tasks.stop': (p) => ({ stopped: ctx.executor.cancel(p.taskId) }),
    'tasks.addDependency': (p) => {
      ctx.tasks.addDependency(p.taskId, p.dependsOnTaskId)
      return { ok: true }
    },
    'tasks.dependencies': (p) => ({
      dependsOn: ctx.tasks.dependencies(p.taskId),
      blocks: ctx.tasks.dependents(p.taskId)
    }),
    'tasks.judge': async (p) => ctx.judge.evaluate(p.taskId, { apply: p.apply !== false }),

    /* --------------------------- executions ---------------------------- */
    'executions.byTask': (p) =>
      ctx.db
        .select()
        .from(executionsTable)
        .where(eq(executionsTable.taskId, p.taskId))
        .orderBy(desc(executionsTable.startedAt))
        .all(),
    'executions.get': (p) =>
      ctx.db.select().from(executionsTable).where(eq(executionsTable.id, p.executionId)).get(),
    'executions.active': () => ctx.executor.runningEntries(),

    /* ------------------------------ events ----------------------------- */
    'events.list': (p) => {
      const limit = Math.min(Number(p.limit ?? 200), 1000)
      const query = ctx.db.select().from(eventsTable)
      const rows = p.projectId
        ? query
            .where(eq(eventsTable.projectId, p.projectId))
            .orderBy(desc(eventsTable.createdAt))
            .limit(limit)
            .all()
        : query.orderBy(desc(eventsTable.createdAt)).limit(limit).all()
      return p.types?.length
        ? rows.filter((r) => (p.types as string[]).includes(r.type))
        : rows
    },
    'events.forTask': (p) =>
      ctx.db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.taskId, p.taskId))
        .orderBy(desc(eventsTable.createdAt))
        .limit(300)
        .all(),
    'events.forAgent': (p) =>
      ctx.db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.agentId, p.agentId))
        .orderBy(desc(eventsTable.createdAt))
        .limit(300)
        .all(),

    /* ---------------------------- messages ----------------------------- */
    'messages.list': (p) => ctx.messages.thread(p.projectId, p.limit ?? 200),
    'messages.inbox': (p) => ctx.messages.inbox(p.agentId, p.unreadOnly !== false),
    'messages.send': (p) => ctx.messages.send(p as never),

    /* ----------------------------- memory ------------------------------ */
    'memory.list': (p) => ctx.memory.list(p.projectId),
    'memory.query': (p) => ctx.memory.query(p as never),
    'memory.write': (p) => ctx.memory.write(p as never),
    'memory.delete': (p) => {
      ctx.memory.delete(p.memoryId)
      return { ok: true }
    },

    /* -------------------------- evaluations ---------------------------- */
    'evaluations.byTask': (p) => ctx.evaluations.listByTask(p.taskId),
    'evaluations.byProject': (p) => ctx.evaluations.listByProject(p.projectId, p.limit ?? 200),
    'evaluations.rubrics': (p) => ctx.evaluations.listRubrics(p.projectId),
    'evaluations.saveRubric': (p) => ctx.evaluations.saveRubric(p as never),

    /* ---------------------------- artifacts ---------------------------- */
    'artifacts.byTask': (p) => ctx.artifacts.listByTask(p.taskId),
    'artifacts.byProject': (p) => ctx.artifacts.listByProject(p.projectId, p.limit ?? 200),

    /* ---------------------------- approvals ---------------------------- */
    'approvals.pending': (p) => ctx.approvals.pending(p.projectId),
    'approvals.list': (p) => ctx.approvals.list(p.projectId, p.limit ?? 100),
    'approvals.resolve': (p) => ctx.approvals.resolve(p.approvalId, p.approved, p.resolution ?? ''),

    /* ---------------------------- schedules ---------------------------- */
    'schedules.list': (p) => ctx.schedules.list(p.projectId),
    'schedules.create': (p) => ctx.schedules.create(p as never),
    'schedules.setEnabled': (p) => ctx.schedules.setEnabled(p.scheduleId, p.enabled),
    'schedules.delete': (p) => {
      ctx.schedules.delete(p.scheduleId)
      return { ok: true }
    },
    'schedules.runNow': (p) => ({
      taskId: ctx.scheduler.fire(ctx.schedules.get(p.scheduleId), Date.now(), { trigger: 'manual' })
    }),

    /* ------------------------------ tools ------------------------------ */
    'tools.toolkits': (p) => ctx.tools.listToolkits(p.projectId),
    'tools.list': (p) => ctx.tools.listTools(p.toolkitId),
    'tools.forAgent': (p) => ctx.tools.toolsForAgentDetailed(p.agentId),
    'tools.create': (p) => ctx.tools.createCustomTool(p as never),
    'tools.update': (p) => ctx.tools.updateTool(p.toolId, p.patch),
    'tools.delete': (p) => {
      ctx.tools.deleteTool(p.toolId)
      return { ok: true }
    },
    'tools.createToolkit': (p) =>
      ctx.tools.createToolkit(p.projectId ?? null, p.name, p.description ?? ''),

    /* ---------------------------- providers ---------------------------- */
    'providers.list': () => ctx.providers.list(),
    'providers.check': async () => ctx.providers.checkAll(),
    'providers.setSecret': (p) => {
      ctx.providers.setSecret(p.key, p.value)
      return { ok: true }
    },
    'providers.hasSecret': (p) => ({ present: Boolean(ctx.providers.getSecret(p.key)) }),

    /* ----------------------------- budgets ----------------------------- */
    'budgets.list': () => ctx.budgets.list(),
    'budgets.set': (p) => ctx.budgets.set(p as never),
    'budgets.check': (p) => ctx.budgets.check(p as never),

    /* ---------------------------- watchdog ----------------------------- */
    'watchdog.recent': (p) => ctx.watchdog.recent(p.projectId, p.limit ?? 50),
    'watchdog.sweep': async () => ctx.watchdog.sweep(),

    /* ---------------------------- workflows ---------------------------- */
    'workflows.list': (p) => ctx.workflows.list(p.projectId),
    'workflows.get': (p) => ctx.workflows.get(p.workflowId),
    'workflows.graph': (p) => ctx.workflows.graph(p.workflowId),
    'workflows.create': (p) => ctx.workflows.create(p as never),
    'workflows.update': (p) => ctx.workflows.update(p.workflowId, p.patch),
    'workflows.delete': (p) => {
      ctx.workflows.delete(p.workflowId)
      return { ok: true }
    },
    'workflows.saveGraph': (p) => ctx.workflows.saveGraph(p as never),
    'workflows.validate': (p) => ctx.workflows.validate(p.workflowId),
    'workflows.run': async (p) =>
      ctx.workflowEngine.run(p.workflowId, {
        trigger: 'manual',
        variables: (p.variables as Record<string, unknown>) ?? {}
      }),
    'workflows.cancel': (p) => ({ cancelled: ctx.workflowEngine.cancel(p.runId) }),
    'workflows.runs': (p) =>
      p.workflowId
        ? ctx.workflows.listRuns(p.workflowId, p.limit ?? 50)
        : ctx.workflows.listProjectRuns(p.projectId, p.limit ?? 50),
    'workflows.nodeRuns': (p) => ctx.workflows.nodeRuns(p.runId),

    /* ------------------------------- git ------------------------------- */
    'git.status': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, p.agentId ?? null)
      return ctx.git.status(root)
    },
    'git.diff': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, p.agentId ?? null)
      return { diff: await ctx.git.diff(root, { file: p.file, staged: p.staged }) }
    },
    'git.log': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, p.agentId ?? null)
      return ctx.git.log(root, p.limit ?? 30)
    },
    'git.commit': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, p.agentId ?? null)
      return { head: await ctx.git.commit(root, p.message) }
    },
    'git.worktrees': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, null)
      const trees = await ctx.git.listWorktrees(root)
      const agents = ctx.agents.list(p.projectId)
      return trees.map((tree) => ({
        ...tree,
        agent:
          agents.find((a) => tree.branch === ctx.git.branchNameFor(a.name, a.id))?.name ?? null
      }))
    },
    'git.worktreeDiff': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, null)
      return { diff: await ctx.git.worktreeDiff(root, p.branch) }
    },
    'git.merge': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, null)
      return { message: await ctx.git.mergeWorktree(root, p.branch, { message: p.message }) }
    },
    'git.removeWorktree': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, null)
      await ctx.git.removeWorktree(root, p.path, p.force === true)
      return { ok: true }
    },
    'git.init': async (p) => {
      const root = await ctx.workspace.rootFor(p.projectId, null)
      await ctx.git.init(root)
      return { ok: true }
    },

    /* ---------------------------- workspace ---------------------------- */
    'files.root': async (p) => ({ root: await ctx.workspace.rootFor(p.projectId, p.agentId ?? null) }),
    'files.list': async (p) => ctx.workspace.list(p.projectId, p.path ?? '.', p.agentId ?? null),
    'files.read': async (p) => ctx.workspace.read(p.projectId, p.path, p.agentId ?? null),
    'files.write': async (p) => {
      await ctx.workspace.write(p.projectId, p.path, p.content, p.agentId ?? null)
      return { ok: true }
    },
    'console.run': async (p) =>
      ctx.workspace.runCommand({
        projectId: p.projectId,
        command: p.command,
        agentId: p.agentId ?? null,
        cwd: p.cwd
      }),
    'console.kill': (p) => ({ killed: ctx.workspace.killCommand(p.sessionId) }),
    'console.sessions': () => ctx.workspace.listSessions(),

    /* ------------------------------ system ----------------------------- */
    'system.info': () => ({
      paths: ctx.paths,
      providers: ctx.providers.list(),
      activeExecutions: ctx.executor.activeCount,
      pendingApprovals: ctx.approvals.pending().length
    }),
    'system.eventTypes': () =>
      ctx.db
        .selectDistinct({ type: eventsTable.type })
        .from(eventsTable)
        .all()
        .map((r) => r.type),
    'system.recentActivity': (p) =>
      ctx.db
        .select()
        .from(eventsTable)
        .where(
          inArray(eventsTable.type, [
            'AGENT_SPAWNED',
            'JUDGE_APPROVED',
            'JUDGE_REJECTED',
            'APPROVAL_REQUESTED',
            'WATCHDOG_ALERT',
            'TASK_COMPLETED',
            'TASK_FAILED'
          ])
        )
        .orderBy(desc(eventsTable.createdAt))
        .limit(p.limit ?? 50)
        .all()
  }
}
