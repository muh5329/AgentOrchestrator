import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type {
  AcceptanceCriterion,
  AgentRelationKind,
  AgentRole,
  AgentStatus,
  ApprovalStatus,
  CatchupPolicy,
  CriterionScore,
  EventLevel,
  EventType,
  ExecutionStatus,
  JudgeDecision,
  MemoryKind,
  MemoryScope,
  MessageType,
  Permission,
  ProjectSettings,
  ProjectStatus,
  RetryPolicy,
  RubricDimension,
  ScheduleKind,
  TaskStatus,
  ToolKind
} from '../../shared/domain'

const now = sql`(unixepoch() * 1000)`

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    mission: text('mission').notNull().default(''),
    status: text('status').$type<ProjectStatus>().notNull().default('DRAFT'),
    rootPath: text('root_path'),
    instructions: text('instructions').notNull().default(''),
    template: text('template'),
    settings: text('settings', { mode: 'json' }).$type<ProjectSettings>().notNull(),
    acceptanceCriteria: text('acceptance_criteria', { mode: 'json' })
      .$type<AcceptanceCriterion[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    archivedAt: integer('archived_at')
  },
  (t) => ({
    statusIdx: index('projects_status_idx').on(t.status),
    createdIdx: index('projects_created_idx').on(t.createdAt)
  })
)

export const projectFiles = sqliteTable(
  'project_files',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    kind: text('kind').notNull().default('file'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({ projectIdx: index('project_files_project_idx').on(t.projectId) })
)

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentAgentId: text('parent_agent_id'),
    name: text('name').notNull(),
    role: text('role').$type<AgentRole>().notNull().default('worker'),
    description: text('description').notNull().default(''),
    systemPrompt: text('system_prompt').notNull().default(''),
    provider: text('provider').notNull().default('claude-code'),
    model: text('model').notNull().default('sonnet'),
    temperature: integer('temperature').notNull().default(70), // stored x100
    status: text('status').$type<AgentStatus>().notNull().default('CREATED'),
    permissions: text('permissions', { mode: 'json' })
      .$type<Permission[]>()
      .notNull()
      .default(sql`'[]'`),
    depth: integer('depth').notNull().default(0),
    maxChildren: integer('max_children'),
    maxDepth: integer('max_depth'),
    isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
    createdByAgentId: text('created_by_agent_id'),
    config: text('config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    lastActiveAt: integer('last_active_at')
  },
  (t) => ({
    projectIdx: index('agents_project_idx').on(t.projectId),
    parentIdx: index('agents_parent_idx').on(t.parentAgentId),
    statusIdx: index('agents_status_idx').on(t.status),
    nameUnique: unique('agents_project_name_unique').on(t.projectId, t.name)
  })
)

export const agentRelationships = sqliteTable(
  'agent_relationships',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromAgentId: text('from_agent_id').notNull(),
    toAgentId: text('to_agent_id').notNull(),
    kind: text('kind').$type<AgentRelationKind>().notNull(),
    metadata: text('metadata', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('agent_rel_project_idx').on(t.projectId),
    fromIdx: index('agent_rel_from_idx').on(t.fromAgentId),
    toIdx: index('agent_rel_to_idx').on(t.toAgentId),
    uniq: unique('agent_rel_unique').on(t.fromAgentId, t.toAgentId, t.kind)
  })
)

/* ------------------------------------------------------------------ */
/* Tools and toolkits                                                  */
/* ------------------------------------------------------------------ */

export const toolkits = sqliteTable(
  'toolkits',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => ({ projectIdx: index('toolkits_project_idx').on(t.projectId) })
)

export const tools = sqliteTable(
  'tools',
  {
    id: text('id').primaryKey(),
    toolkitId: text('toolkit_id')
      .notNull()
      .references(() => toolkits.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    kind: text('kind').$type<ToolKind>().notNull(),
    inputSchema: text('input_schema', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    outputSchema: text('output_schema', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    implementation: text('implementation').notNull().default(''),
    requiredPermissions: text('required_permissions', { mode: 'json' })
      .$type<Permission[]>()
      .notNull()
      .default(sql`'[]'`),
    timeoutMs: integer('timeout_ms').notNull().default(60_000),
    isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => ({
    toolkitIdx: index('tools_toolkit_idx').on(t.toolkitId),
    nameUnique: unique('tools_toolkit_name_unique').on(t.toolkitId, t.name)
  })
)

export const agentToolkits = sqliteTable(
  'agent_toolkits',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolkitId: text('toolkit_id')
      .notNull()
      .references(() => toolkits.id, { onDelete: 'cascade' })
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.toolkitId] }) })
)

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    parentTaskId: text('parent_task_id'),
    createdByAgentId: text('created_by_agent_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<TaskStatus>().notNull().default('BACKLOG'),
    priority: integer('priority').notNull().default(50),
    acceptanceCriteria: text('acceptance_criteria', { mode: 'json' })
      .$type<AcceptanceCriterion[]>()
      .notNull()
      .default(sql`'[]'`),
    context: text('context', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    deadline: integer('deadline'),
    retryPolicy: text('retry_policy', { mode: 'json' }).$type<RetryPolicy | null>(),
    attempt: integer('attempt').notNull().default(0),
    requiresJudge: integer('requires_judge', { mode: 'boolean' }).notNull().default(true),
    judgeAgentId: text('judge_agent_id'),
    revisionOfTaskId: text('revision_of_task_id'),
    revisionCount: integer('revision_count').notNull().default(0),
    score: integer('score'), // 0..100
    result: text('result', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    error: text('error'),
    blockedReason: text('blocked_reason'),
    scheduleId: text('schedule_id'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at')
  },
  (t) => ({
    projectIdx: index('tasks_project_idx').on(t.projectId),
    agentIdx: index('tasks_agent_idx').on(t.agentId),
    statusIdx: index('tasks_status_idx').on(t.status),
    createdIdx: index('tasks_created_idx').on(t.createdAt),
    parentIdx: index('tasks_parent_idx').on(t.parentTaskId)
  })
)

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: text('depends_on_task_id').notNull(),
    kind: text('kind').notNull().default('completion'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    taskIdx: index('task_deps_task_idx').on(t.taskId),
    depIdx: index('task_deps_dep_idx').on(t.dependsOnTaskId),
    uniq: unique('task_deps_unique').on(t.taskId, t.dependsOnTaskId)
  })
)

/* ------------------------------------------------------------------ */
/* Executions                                                          */
/* ------------------------------------------------------------------ */

export const executions = sqliteTable(
  'task_executions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    agentId: text('agent_id').notNull(),
    parentExecutionId: text('parent_execution_id'),
    depth: integer('depth').notNull().default(0),
    status: text('status').$type<ExecutionStatus>().notNull().default('PENDING'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    attempt: integer('attempt').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: integer('cost_usd_micros').notNull().default(0), // micro-dollars
    toolCallCount: integer('tool_call_count').notNull().default(0),
    iterations: integer('iterations').notNull().default(0),
    summary: text('summary'),
    error: text('error'),
    transcript: text('transcript', { mode: 'json' })
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'`),
    startedAt: integer('started_at').notNull().default(now),
    endedAt: integer('ended_at'),
    heartbeatAt: integer('heartbeat_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('exec_project_idx').on(t.projectId),
    taskIdx: index('exec_task_idx').on(t.taskId),
    agentIdx: index('exec_agent_idx').on(t.agentId),
    statusIdx: index('exec_status_idx').on(t.status),
    startedIdx: index('exec_started_idx').on(t.startedAt)
  })
)

/* ------------------------------------------------------------------ */
/* Events, messages, memory                                            */
/* ------------------------------------------------------------------ */

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id'),
    agentId: text('agent_id'),
    taskId: text('task_id'),
    executionId: text('execution_id'),
    type: text('type').$type<EventType>().notNull(),
    level: text('level').$type<EventLevel>().notNull().default('info'),
    message: text('message').notNull().default(''),
    data: text('data', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('events_project_idx').on(t.projectId),
    agentIdx: index('events_agent_idx').on(t.agentId),
    taskIdx: index('events_task_idx').on(t.taskId),
    typeIdx: index('events_type_idx').on(t.type),
    createdIdx: index('events_created_idx').on(t.createdAt)
  })
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromAgentId: text('from_agent_id'),
    toAgentId: text('to_agent_id'),
    taskId: text('task_id'),
    type: text('type').$type<MessageType>().notNull().default('MESSAGE'),
    priority: integer('priority').notNull().default(50),
    content: text('content').notNull(),
    data: text('data', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    readAt: integer('read_at'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('messages_project_idx').on(t.projectId),
    toIdx: index('messages_to_idx').on(t.toAgentId),
    createdIdx: index('messages_created_idx').on(t.createdAt)
  })
)

export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    taskId: text('task_id'),
    scope: text('scope').$type<MemoryScope>().notNull().default('project'),
    kind: text('kind').$type<MemoryKind>().notNull().default('fact'),
    key: text('key').notNull().default(''),
    content: text('content').notNull(),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    importance: integer('importance').notNull().default(50),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('memories_project_idx').on(t.projectId),
    agentIdx: index('memories_agent_idx').on(t.agentId),
    scopeIdx: index('memories_scope_idx').on(t.scope)
  })
)

/* ------------------------------------------------------------------ */
/* Judgment                                                            */
/* ------------------------------------------------------------------ */

export const rubrics = sqliteTable('rubrics', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  dimensions: text('dimensions', { mode: 'json' }).$type<RubricDimension[]>().notNull(),
  passThreshold: integer('pass_threshold').notNull().default(80),
  escalateThreshold: integer('escalate_threshold').notNull().default(30),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now)
})

export const evaluations = sqliteTable(
  'evaluations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    executionId: text('execution_id'),
    judgeAgentId: text('judge_agent_id'),
    rubricId: text('rubric_id'),
    score: integer('score').notNull().default(0), // 0..100
    decision: text('decision').$type<JudgeDecision>().notNull(),
    criteria: text('criteria', { mode: 'json' })
      .$type<CriterionScore[]>()
      .notNull()
      .default(sql`'[]'`),
    checklist: text('checklist', { mode: 'json' })
      .$type<AcceptanceCriterion[]>()
      .notNull()
      .default(sql`'[]'`),
    issues: text('issues', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    requiredChanges: text('required_changes', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary').notNull().default(''),
    attempt: integer('attempt').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('evals_project_idx').on(t.projectId),
    taskIdx: index('evals_task_idx').on(t.taskId)
  })
)

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id'),
    executionId: text('execution_id'),
    agentId: text('agent_id'),
    kind: text('kind').notNull().default('note'),
    title: text('title').notNull().default(''),
    path: text('path'),
    content: text('content'),
    meta: text('meta', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('artifacts_project_idx').on(t.projectId),
    taskIdx: index('artifacts_task_idx').on(t.taskId)
  })
)

/* ------------------------------------------------------------------ */
/* Scheduling, approvals, budgets                                      */
/* ------------------------------------------------------------------ */

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    name: text('name').notNull().default(''),
    kind: text('kind').$type<ScheduleKind>().notNull(),
    cron: text('cron'),
    intervalMs: integer('interval_ms'),
    runAt: integer('run_at'),
    eventType: text('event_type'),
    dependsOnTaskId: text('depends_on_task_id'),
    timezone: text('timezone').notNull().default('local'),
    catchupPolicy: text('catchup_policy').$type<CatchupPolicy>().notNull().default('run_once'),
    taskTemplate: text('task_template', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastRunAt: integer('last_run_at'),
    nextRunAt: integer('next_run_at'),
    runCount: integer('run_count').notNull().default(0),
    maxRuns: integer('max_runs'),
    createdByAgentId: text('created_by_agent_id'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('schedules_project_idx').on(t.projectId),
    nextRunIdx: index('schedules_next_run_idx').on(t.nextRunAt),
    eventIdx: index('schedules_event_idx').on(t.eventType)
  })
)

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    taskId: text('task_id'),
    executionId: text('execution_id'),
    action: text('action').notNull(),
    reason: text('reason').notNull().default(''),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<ApprovalStatus>().notNull().default('PENDING'),
    resolution: text('resolution'),
    decidedAt: integer('decided_at'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    projectIdx: index('approvals_project_idx').on(t.projectId),
    statusIdx: index('approvals_status_idx').on(t.status)
  })
)

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(), // global | project | agent | task
    scopeId: text('scope_id'),
    maxCostUsdMicros: integer('max_cost_usd_micros'),
    maxTokens: integer('max_tokens'),
    maxRuntimeMs: integer('max_runtime_ms'),
    maxToolCalls: integer('max_tool_calls'),
    spentCostUsdMicros: integer('spent_cost_usd_micros').notNull().default(0),
    spentTokens: integer('spent_tokens').notNull().default(0),
    action: text('action').notNull().default('pause'), // pause | fallback | ask | terminate
    period: text('period').notNull().default('total'), // total | daily
    periodStart: integer('period_start'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => ({ scopeIdx: index('budgets_scope_idx').on(t.scope, t.scopeId) })
)

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // cli | api
  adapter: text('adapter').notNull(),
  baseUrl: text('base_url'),
  binaryPath: text('binary_path'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  credentialRef: text('credential_ref'),
  config: text('config', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now)
})

export const modelConfigs = sqliteTable(
  'model_configs',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    alias: text('alias').notNull().default(''),
    tier: text('tier').notNull().default('standard'), // cheap | standard | strong
    contextWindow: integer('context_window').notNull().default(200_000),
    inputCostPerMTokMicros: integer('input_cost_per_mtok_micros').notNull().default(0),
    outputCostPerMTokMicros: integer('output_cost_per_mtok_micros').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true)
  },
  (t) => ({ providerIdx: index('model_configs_provider_idx').on(t.providerId) })
)

/* ------------------------------------------------------------------ */
/* Workflows                                                           */
/* ------------------------------------------------------------------ */

export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** manual | event | schedule */
    trigger: text('trigger').notNull().default('manual'),
    eventType: text('event_type'),
    variables: text('variables', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => ({ projectIdx: index('workflows_project_idx').on(t.projectId) })
)

export const workflowNodes = sqliteTable(
  'workflow_nodes',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    label: text('label').notNull().default(''),
    config: text('config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0)
  },
  (t) => ({ workflowIdx: index('workflow_nodes_workflow_idx').on(t.workflowId) })
)

export const workflowEdges = sqliteTable(
  'workflow_edges',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    fromNodeId: text('from_node_id').notNull(),
    toNodeId: text('to_node_id').notNull(),
    /** Branch selector: "true"/"false" from a condition, "body"/"done" from a loop. */
    label: text('label'),
    condition: text('condition')
  },
  (t) => ({ workflowIdx: index('workflow_edges_workflow_idx').on(t.workflowId) })
)

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull(),
    status: text('status').notNull().default('RUNNING'), // RUNNING | COMPLETED | FAILED | CANCELLED
    trigger: text('trigger').notNull().default('manual'),
    context: text('context', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    error: text('error'),
    steps: integer('steps').notNull().default(0),
    startedAt: integer('started_at').notNull().default(now),
    endedAt: integer('ended_at')
  },
  (t) => ({
    workflowIdx: index('workflow_runs_workflow_idx').on(t.workflowId),
    startedIdx: index('workflow_runs_started_idx').on(t.startedAt)
  })
)

export const workflowNodeRuns = sqliteTable(
  'workflow_node_runs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    kind: text('kind').notNull(),
    label: text('label').notNull().default(''),
    status: text('status').notNull().default('RUNNING'),
    iteration: integer('iteration').notNull().default(0),
    output: text('output', { mode: 'json' }).$type<unknown>(),
    error: text('error'),
    startedAt: integer('started_at').notNull().default(now),
    endedAt: integer('ended_at')
  },
  (t) => ({ runIdx: index('workflow_node_runs_run_idx').on(t.runId) })
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull().default(now)
})

export type ProjectRow = typeof projects.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type TaskRow = typeof tasks.$inferSelect
export type ExecutionRow = typeof executions.$inferSelect
export type EventRow = typeof events.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type MemoryRow = typeof memories.$inferSelect
export type EvaluationRow = typeof evaluations.$inferSelect
export type ScheduleRow = typeof schedules.$inferSelect
export type ApprovalRow = typeof approvals.$inferSelect
export type ToolRow = typeof tools.$inferSelect
export type ToolkitRow = typeof toolkits.$inferSelect
export type ArtifactRow = typeof artifacts.$inferSelect
export type AgentRelationshipRow = typeof agentRelationships.$inferSelect
export type BudgetRow = typeof budgets.$inferSelect
export type ProviderRow = typeof providers.$inferSelect
export type ModelConfigRow = typeof modelConfigs.$inferSelect
export type RubricRow = typeof rubrics.$inferSelect
export type WorkflowRow = typeof workflows.$inferSelect
export type WorkflowNodeRow = typeof workflowNodes.$inferSelect
export type WorkflowEdgeRow = typeof workflowEdges.$inferSelect
export type WorkflowRunRow = typeof workflowRuns.$inferSelect
export type WorkflowNodeRunRow = typeof workflowNodeRuns.$inferSelect
