import type {
  Agent,
  AgentGraph,
  AppEventRecord,
  Approval,
  Artifact,
  Evaluation,
  Execution,
  Memory,
  Message,
  Project,
  ProjectStats,
  ProjectTemplateInfo,
  ProviderInfo,
  Rubric,
  Schedule,
  Task,
  Tool,
  Toolkit,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowRun,
  GitStatus,
  Worktree,
  FileNode,
  ConsoleSession
} from '@shared/models'
import type { WorkflowValidationIssue } from '@shared/workflow'
import type { AgentStatus, Permission, TaskStatus } from '@shared/domain'

function invoke<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
  return window.ao.invoke<T>(method, payload)
}

/** Thin, typed wrappers over the single IPC channel. */
export const api = {
  projects: {
    list: () => invoke<Project[]>('projects.list'),
    get: (projectId: string) => invoke<Project>('projects.get', { projectId }),
    create: (input: Record<string, unknown>) => invoke<Project>('projects.create', input),
    createFromMission: (input: Record<string, unknown>) =>
      invoke<{ project: Project; kickoffTask: Task | null }>('projects.createFromMission', input),
    update: (projectId: string, patch: Record<string, unknown>) =>
      invoke<Project>('projects.update', { projectId, patch }),
    remove: (projectId: string) => invoke<{ ok: true }>('projects.delete', { projectId }),
    archive: (projectId: string) => invoke<{ ok: true }>('projects.archive', { projectId }),
    stats: (projectId: string) => invoke<ProjectStats>('projects.stats', { projectId }),
    launch: (projectId: string) => invoke<Task>('projects.launch', { projectId }),
    pause: (projectId: string) => invoke<{ ok: true }>('projects.pause', { projectId }),
    resume: (projectId: string) => invoke<{ ok: true }>('projects.resume', { projectId }),
    templates: () => invoke<ProjectTemplateInfo[]>('projects.templates')
  },
  agents: {
    list: (projectId: string) => invoke<Agent[]>('agents.list', { projectId }),
    get: (agentId: string) => invoke<Agent>('agents.get', { agentId }),
    create: (input: Record<string, unknown>) => invoke<Agent>('agents.create', input),
    update: (agentId: string, patch: Record<string, unknown>) =>
      invoke<Agent>('agents.update', { agentId, patch }),
    remove: (agentId: string, cascade = true) =>
      invoke<string[]>('agents.delete', { agentId, cascade }),
    clone: (agentId: string, overrides: Record<string, unknown> = {}) =>
      invoke<Agent>('agents.clone', { agentId, overrides }),
    setStatus: (agentId: string, status: AgentStatus) =>
      invoke<Agent>('agents.setStatus', { agentId, status }),
    graph: (projectId: string) => invoke<AgentGraph>('agents.graph', { projectId }),
    toolkits: (agentId: string) => invoke<string[]>('agents.toolkits', { agentId }),
    setToolkits: (agentId: string, toolkitIds: string[]) =>
      invoke<{ ok: true }>('agents.setToolkits', { agentId, toolkitIds }),
    grant: (agentId: string, permissions: Permission[]) =>
      invoke<Agent>('agents.grant', { agentId, permissions }),
    revoke: (agentId: string, permissions: Permission[]) =>
      invoke<Agent>('agents.revoke', { agentId, permissions })
  },
  tasks: {
    list: (projectId: string) => invoke<Task[]>('tasks.list', { projectId }),
    get: (taskId: string) => invoke<Task>('tasks.get', { taskId }),
    byAgent: (agentId: string) => invoke<Task[]>('tasks.byAgent', { agentId }),
    create: (input: Record<string, unknown>) => invoke<Task>('tasks.create', input),
    update: (taskId: string, patch: Record<string, unknown>) =>
      invoke<Task>('tasks.update', { taskId, patch }),
    assign: (taskId: string, agentId: string) => invoke<Task>('tasks.assign', { taskId, agentId }),
    setStatus: (taskId: string, status: TaskStatus) =>
      invoke<Task>('tasks.setStatus', { taskId, status }),
    cancel: (taskId: string, reason?: string) => invoke<Task>('tasks.cancel', { taskId, reason }),
    run: (taskId: string) => invoke<{ ok: true }>('tasks.run', { taskId }),
    stop: (taskId: string) => invoke<{ stopped: boolean }>('tasks.stop', { taskId }),
    addDependency: (taskId: string, dependsOnTaskId: string) =>
      invoke<{ ok: true }>('tasks.addDependency', { taskId, dependsOnTaskId }),
    dependencies: (taskId: string) =>
      invoke<{ dependsOn: string[]; blocks: string[] }>('tasks.dependencies', { taskId }),
    judge: (taskId: string, apply = true) => invoke<unknown>('tasks.judge', { taskId, apply })
  },
  executions: {
    byTask: (taskId: string) => invoke<Execution[]>('executions.byTask', { taskId }),
    get: (executionId: string) => invoke<Execution>('executions.get', { executionId })
  },
  events: {
    list: (projectId: string | null, limit = 250) =>
      invoke<AppEventRecord[]>('events.list', { projectId, limit }),
    forTask: (taskId: string) => invoke<AppEventRecord[]>('events.forTask', { taskId }),
    forAgent: (agentId: string) => invoke<AppEventRecord[]>('events.forAgent', { agentId })
  },
  messages: {
    list: (projectId: string) => invoke<Message[]>('messages.list', { projectId }),
    send: (input: Record<string, unknown>) => invoke<Message>('messages.send', input)
  },
  memory: {
    list: (projectId: string) => invoke<Memory[]>('memory.list', { projectId }),
    write: (input: Record<string, unknown>) => invoke<Memory>('memory.write', input),
    remove: (memoryId: string) => invoke<{ ok: true }>('memory.delete', { memoryId })
  },
  evaluations: {
    byTask: (taskId: string) => invoke<Evaluation[]>('evaluations.byTask', { taskId }),
    byProject: (projectId: string) => invoke<Evaluation[]>('evaluations.byProject', { projectId }),
    rubrics: (projectId: string) => invoke<Rubric[]>('evaluations.rubrics', { projectId })
  },
  artifacts: {
    byTask: (taskId: string) => invoke<Artifact[]>('artifacts.byTask', { taskId }),
    byProject: (projectId: string) => invoke<Artifact[]>('artifacts.byProject', { projectId })
  },
  approvals: {
    pending: (projectId?: string) => invoke<Approval[]>('approvals.pending', { projectId }),
    list: (projectId: string) => invoke<Approval[]>('approvals.list', { projectId }),
    resolve: (approvalId: string, approved: boolean, resolution = '') =>
      invoke<Approval>('approvals.resolve', { approvalId, approved, resolution })
  },
  schedules: {
    list: (projectId: string) => invoke<Schedule[]>('schedules.list', { projectId }),
    create: (input: Record<string, unknown>) => invoke<Schedule>('schedules.create', input),
    setEnabled: (scheduleId: string, enabled: boolean) =>
      invoke<Schedule>('schedules.setEnabled', { scheduleId, enabled }),
    remove: (scheduleId: string) => invoke<{ ok: true }>('schedules.delete', { scheduleId }),
    runNow: (scheduleId: string) => invoke<{ taskId: string | null }>('schedules.runNow', { scheduleId })
  },
  tools: {
    toolkits: (projectId?: string) => invoke<Toolkit[]>('tools.toolkits', { projectId }),
    list: (toolkitId: string) => invoke<Tool[]>('tools.list', { toolkitId }),
    forAgent: (agentId: string) => invoke<Tool[]>('tools.forAgent', { agentId }),
    create: (input: Record<string, unknown>) => invoke<Tool>('tools.create', input),
    remove: (toolId: string) => invoke<{ ok: true }>('tools.delete', { toolId })
  },
  providers: {
    list: () => invoke<ProviderInfo[]>('providers.list'),
    check: () => invoke<ProviderInfo[]>('providers.check'),
    setSecret: (key: string, value: string | null) =>
      invoke<{ ok: true }>('providers.setSecret', { key, value }),
    hasSecret: (key: string) => invoke<{ present: boolean }>('providers.hasSecret', { key })
  },
  workflows: {
    list: (projectId: string) => invoke<Workflow[]>('workflows.list', { projectId }),
    get: (workflowId: string) => invoke<Workflow>('workflows.get', { workflowId }),
    graph: (workflowId: string) =>
      invoke<{ workflow: Workflow; nodes: WorkflowNode[]; edges: WorkflowEdge[] }>(
        'workflows.graph',
        { workflowId }
      ),
    create: (input: Record<string, unknown>) => invoke<Workflow>('workflows.create', input),
    update: (workflowId: string, patch: Record<string, unknown>) =>
      invoke<Workflow>('workflows.update', { workflowId, patch }),
    remove: (workflowId: string) => invoke<{ ok: true }>('workflows.delete', { workflowId }),
    saveGraph: (input: Record<string, unknown>) =>
      invoke<{ workflow: Workflow; nodes: WorkflowNode[]; edges: WorkflowEdge[] }>(
        'workflows.saveGraph',
        input
      ),
    validate: (workflowId: string) =>
      invoke<WorkflowValidationIssue[]>('workflows.validate', { workflowId }),
    run: (workflowId: string, variables: Record<string, unknown> = {}) =>
      invoke<{ runId: string; status: string; steps: number; error?: string }>('workflows.run', {
        workflowId,
        variables
      }),
    cancel: (runId: string) => invoke<{ cancelled: boolean }>('workflows.cancel', { runId }),
    runs: (projectId: string, workflowId?: string) =>
      invoke<WorkflowRun[]>('workflows.runs', { projectId, workflowId }),
    nodeRuns: (runId: string) => invoke<WorkflowNodeRun[]>('workflows.nodeRuns', { runId })
  },
  git: {
    status: (projectId: string, agentId?: string | null) =>
      invoke<GitStatus>('git.status', { projectId, agentId }),
    diff: (projectId: string, file?: string, agentId?: string | null) =>
      invoke<{ diff: string }>('git.diff', { projectId, file, agentId }),
    log: (projectId: string, agentId?: string | null) =>
      invoke<Array<{ hash: string; author: string; date: string; subject: string }>>('git.log', {
        projectId,
        agentId
      }),
    commit: (projectId: string, message: string, agentId?: string | null) =>
      invoke<{ head: string }>('git.commit', { projectId, message, agentId }),
    worktrees: (projectId: string) => invoke<Worktree[]>('git.worktrees', { projectId }),
    worktreeDiff: (projectId: string, branch: string) =>
      invoke<{ diff: string }>('git.worktreeDiff', { projectId, branch }),
    merge: (projectId: string, branch: string, message?: string) =>
      invoke<{ message: string }>('git.merge', { projectId, branch, message }),
    removeWorktree: (projectId: string, path: string, force = false) =>
      invoke<{ ok: true }>('git.removeWorktree', { projectId, path, force }),
    init: (projectId: string) => invoke<{ ok: true }>('git.init', { projectId })
  },
  files: {
    root: (projectId: string, agentId?: string | null) =>
      invoke<{ root: string }>('files.root', { projectId, agentId }),
    list: (projectId: string, path = '.', agentId?: string | null) =>
      invoke<FileNode[]>('files.list', { projectId, path, agentId }),
    read: (projectId: string, path: string, agentId?: string | null) =>
      invoke<{ path: string; content: string; truncated: boolean; size: number }>('files.read', {
        projectId,
        path,
        agentId
      }),
    write: (projectId: string, path: string, content: string, agentId?: string | null) =>
      invoke<{ ok: true }>('files.write', { projectId, path, content, agentId })
  },
  console: {
    run: (projectId: string, command: string, agentId?: string | null) =>
      invoke<ConsoleSession>('console.run', { projectId, command, agentId }),
    kill: (sessionId: string) => invoke<{ killed: boolean }>('console.kill', { sessionId }),
    sessions: () => invoke<ConsoleSession[]>('console.sessions')
  },
  system: {
    info: () =>
      invoke<{
        paths: Record<string, string>
        providers: ProviderInfo[]
        activeExecutions: number
        pendingApprovals: number
      }>('system.info')
  }
}
