/**
 * Plain shapes shared with the renderer.
 *
 * These mirror the database rows structurally without dragging the ORM across
 * the process boundary.
 */
import type {
  AcceptanceCriterion,
  AgentRelationKind,
  AgentRole,
  AgentStatus,
  ApprovalStatus,
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
} from './domain'

export interface Project {
  id: string
  name: string
  description: string
  mission: string
  status: ProjectStatus
  rootPath: string | null
  instructions: string
  template: string | null
  settings: ProjectSettings
  acceptanceCriteria: AcceptanceCriterion[]
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface Agent {
  id: string
  projectId: string
  parentAgentId: string | null
  name: string
  role: AgentRole
  description: string
  systemPrompt: string
  provider: string
  model: string
  temperature: number
  status: AgentStatus
  permissions: Permission[]
  depth: number
  maxChildren: number | null
  maxDepth: number | null
  isBuiltIn: boolean
  createdByAgentId: string | null
  config: Record<string, unknown>
  createdAt: number
  updatedAt: number
  lastActiveAt: number | null
}

export interface AgentGraphNode extends Agent {
  childCount: number
  openTasks: number
  runningTasks: number
  lastScore: number | null
}

export interface AgentRelationship {
  id: string
  projectId: string
  fromAgentId: string
  toAgentId: string
  kind: AgentRelationKind
  metadata: Record<string, unknown>
  createdAt: number
}

export interface AgentGraph {
  nodes: AgentGraphNode[]
  edges: AgentRelationship[]
}

export interface Task {
  id: string
  projectId: string
  agentId: string | null
  parentTaskId: string | null
  createdByAgentId: string | null
  title: string
  description: string
  status: TaskStatus
  priority: number
  acceptanceCriteria: AcceptanceCriterion[]
  context: Record<string, unknown>
  deadline: number | null
  retryPolicy: RetryPolicy | null
  attempt: number
  requiresJudge: boolean
  judgeAgentId: string | null
  revisionOfTaskId: string | null
  revisionCount: number
  score: number | null
  result: Record<string, unknown> | null
  error: string | null
  blockedReason: string | null
  scheduleId: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
}

export interface Execution {
  id: string
  projectId: string
  taskId: string
  agentId: string
  parentExecutionId: string | null
  depth: number
  status: ExecutionStatus
  provider: string
  model: string
  attempt: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  toolCallCount: number
  iterations: number
  summary: string | null
  error: string | null
  transcript: Array<{ at: number; kind: string; content: string; data?: Record<string, unknown> }>
  startedAt: number
  endedAt: number | null
  heartbeatAt: number
}

export interface AppEventRecord {
  id: string
  projectId: string | null
  agentId: string | null
  taskId: string | null
  executionId: string | null
  type: EventType
  level: EventLevel
  message: string
  data: Record<string, unknown>
  createdAt: number
}

export interface Message {
  id: string
  projectId: string
  fromAgentId: string | null
  toAgentId: string | null
  taskId: string | null
  type: MessageType
  priority: number
  content: string
  data: Record<string, unknown>
  readAt: number | null
  createdAt: number
}

export interface Memory {
  id: string
  projectId: string
  agentId: string | null
  taskId: string | null
  scope: MemoryScope
  kind: MemoryKind
  key: string
  content: string
  tags: string[]
  importance: number
  createdAt: number
  updatedAt: number
}

export interface Evaluation {
  id: string
  projectId: string
  taskId: string
  executionId: string | null
  judgeAgentId: string | null
  rubricId: string | null
  score: number
  decision: JudgeDecision
  criteria: CriterionScore[]
  checklist: AcceptanceCriterion[]
  issues: string[]
  requiredChanges: string[]
  summary: string
  attempt: number
  createdAt: number
}

export interface Approval {
  id: string
  projectId: string
  agentId: string | null
  taskId: string | null
  executionId: string | null
  action: string
  reason: string
  payload: Record<string, unknown>
  status: ApprovalStatus
  resolution: string | null
  decidedAt: number | null
  expiresAt: number | null
  createdAt: number
}

export interface Schedule {
  id: string
  projectId: string
  agentId: string | null
  name: string
  kind: ScheduleKind
  cron: string | null
  intervalMs: number | null
  runAt: number | null
  eventType: string | null
  dependsOnTaskId: string | null
  timezone: string
  catchupPolicy: string
  taskTemplate: Record<string, unknown>
  enabled: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  runCount: number
  maxRuns: number | null
  createdAt: number
  updatedAt: number
}

export interface Toolkit {
  id: string
  projectId: string | null
  name: string
  description: string
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
}

export interface Tool {
  id: string
  toolkitId: string
  name: string
  description: string
  kind: ToolKind
  inputSchema: Record<string, unknown>
  implementation: string
  requiredPermissions: Permission[]
  timeoutMs: number
  isBuiltIn: boolean
  enabled: boolean
  /** Calling this stops for a human, either by nature or by project policy. */
  dangerous?: boolean
  /** False when the agent holds the toolkit but not the permissions it needs. */
  reachable?: boolean
}

export interface Artifact {
  id: string
  projectId: string
  taskId: string | null
  executionId: string | null
  agentId: string | null
  kind: string
  title: string
  path: string | null
  content: string | null
  meta: Record<string, unknown>
  createdAt: number
}

export interface Rubric {
  id: string
  projectId: string | null
  name: string
  dimensions: RubricDimension[]
  passThreshold: number
  escalateThreshold: number
  isDefault: boolean
  createdAt: number
}

export interface ProjectStats {
  agents: number
  agentsRunning: number
  agentsIdle: number
  agentsFailed: number
  tasksTotal: number
  tasksByStatus: Record<string, number>
  pendingReviews: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  executions: number
  averageScore: number | null
  requirementCoverage: number | null
  progress: number
}

export interface ProviderInfo {
  id: string
  label: string
  kind: string
  availability: { available: boolean; detail: string; version?: string } | null
}

export interface ProjectTemplateInfo {
  id: string
  name: string
  description: string
  instructions: string
  orchestratorToolkits: string[]
  orchestratorPermissions: Permission[]
  suggestedCriteria: string[]
}

/* ------------------------------------------------------------------ */
/* Workflows, git and the workspace                                    */
/* ------------------------------------------------------------------ */

export interface Workflow {
  id: string
  projectId: string
  name: string
  description: string
  enabled: boolean
  trigger: string
  eventType: string | null
  variables: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface WorkflowNode {
  id: string
  workflowId: string
  kind: string
  label: string
  config: Record<string, unknown>
  x: number
  y: number
}

export interface WorkflowEdge {
  id: string
  workflowId: string
  fromNodeId: string
  toNodeId: string
  label: string | null
  condition: string | null
}

export interface WorkflowRun {
  id: string
  workflowId: string
  projectId: string
  status: string
  trigger: string
  context: Record<string, unknown>
  error: string | null
  steps: number
  startedAt: number
  endedAt: number | null
}

export interface WorkflowNodeRun {
  id: string
  runId: string
  nodeId: string
  kind: string
  label: string
  status: string
  iteration: number
  output: unknown
  error: string | null
  startedAt: number
  endedAt: number | null
}

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
  agentId: string | null
  isMain: boolean
  agent?: string | null
}

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

/* ------------------------------------------------------------------ */
/* Fleet - every agent in every project, for the sessions rail          */
/* ------------------------------------------------------------------ */

export interface FleetProject extends Project {
  agentCount: number
  openTasks: number
  runningTasks: number
  completedTasks: number
  totalTasks: number
  costUsd: number
}

export interface FleetAgent extends Agent {
  openTasks: number
  runningTasks: number
  completedTasks: number
  totalTasks: number
  lastScore: number | null
  costUsd: number
  tokens: number
  /** The agent's own git branch, when the project isolates workspaces. */
  branch: string | null
}

export interface FleetOverview {
  projects: FleetProject[]
  agents: FleetAgent[]
}

/** SMTP account state, as the settings screen needs to see it. */
export interface MailConfig {
  configured: boolean
  host: string
  port: number
  user: string
  from: string
  secure: boolean
}

/**
 * Which account a Claude Code run would be billed to, and which was chosen.
 *
 * Shown before anything is spent, because the CLI's own precedence puts an API
 * key above the subscription and a person on a plan should not discover that
 * from a "credit balance is too low" halfway through a run.
 */
export interface BillingState {
  account: 'subscription' | 'api-key' | 'gateway'
  detail: string
  /** The environment variable that decided it, when one did. */
  cause?: string
  /** What the person chose, as distinct from what the environment produced. */
  mode: 'subscription' | 'api-key'
}

/** A local OpenAI-compatible model server, as the settings screen sees it. */
export interface LocalConfig {
  baseUrl: string
  model: string
  hasKey: boolean
}
