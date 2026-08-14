/**
 * Shared domain vocabulary.
 *
 * This module is imported by the main process, the preload bridge and the
 * renderer. It must never import Node or Electron APIs.
 */

export const AGENT_STATUSES = [
  'CREATED',
  'IDLE',
  'QUEUED',
  'RUNNING',
  'WAITING',
  'BLOCKED',
  'REVIEW',
  'FAILED',
  'COMPLETED',
  'PAUSED',
  'DISABLED'
] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export const TASK_STATUSES = [
  'BACKLOG',
  'READY',
  'QUEUED',
  'RUNNING',
  'WAITING',
  'BLOCKED',
  'REVIEW',
  'FAILED',
  'COMPLETED',
  'CANCELLED'
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['COMPLETED', 'CANCELLED']

export const EXECUTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMEOUT'
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export const PROJECT_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'REVIEW',
  'COMPLETED',
  'ARCHIVED'
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Least-privilege capability grants. An agent holds an explicit list. */
export const PERMISSIONS = [
  'FILES_READ',
  'FILES_WRITE',
  'SHELL_EXECUTE',
  'NETWORK_ACCESS',
  'WEB_ACCESS',
  'GIT_WRITE',
  'AGENT_CREATE',
  'AGENT_DELETE',
  'AGENT_INVOKE',
  'AGENT_MESSAGE',
  'PROJECT_CREATE',
  'PROJECT_DELETE',
  'TASK_CREATE',
  'TASK_UPDATE',
  'SCHEDULE_CREATE',
  'TOOL_CREATE',
  'MEMORY_WRITE',
  'JUDGE_INVOKE',
  'EXTERNAL_API'
] as const
export type Permission = (typeof PERMISSIONS)[number]

/** Sensible conservative default for a freshly created agent. */
export const DEFAULT_AGENT_PERMISSIONS: Permission[] = [
  'FILES_READ',
  'AGENT_MESSAGE',
  'TASK_CREATE',
  'MEMORY_WRITE'
]

export const AGENT_RELATION_KINDS = [
  'PARENT_OF',
  'DELEGATES_TO',
  'INVOKES',
  'REPORTS_TO',
  'REVIEWS',
  'DEPENDS_ON'
] as const
export type AgentRelationKind = (typeof AGENT_RELATION_KINDS)[number]

export const TOOL_KINDS = ['builtin', 'javascript', 'shell', 'http', 'mcp', 'agent'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

export const SCHEDULE_KINDS = ['once', 'interval', 'cron', 'event', 'dependency'] as const
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number]

export const CATCHUP_POLICIES = ['skip', 'run_once', 'run_all'] as const
export type CatchupPolicy = (typeof CATCHUP_POLICIES)[number]

export const JUDGE_DECISIONS = ['APPROVED', 'REJECTED', 'ESCALATE'] as const
export type JudgeDecision = (typeof JUDGE_DECISIONS)[number]

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'DENIED', 'EXPIRED'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export const MESSAGE_TYPES = [
  'MESSAGE',
  'DELEGATION',
  'HELP_REQUEST',
  'REPORT',
  'BROADCAST',
  'RESULT'
] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

export const MEMORY_KINDS = [
  'fact',
  'decision',
  'constraint',
  'preference',
  'summary',
  'lesson',
  'artifact_ref'
] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_SCOPES = ['project', 'agent', 'task', 'shared'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export const AGENT_ROLES = [
  'orchestrator',
  'judge',
  'worker',
  'reviewer',
  'researcher',
  'watchdog'
] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

/** Every meaningful state change in the system is published as one of these. */
export const EVENT_TYPES = [
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  'PROJECT_COMPLETED',
  'AGENT_CREATED',
  'AGENT_UPDATED',
  'AGENT_DELETED',
  'AGENT_SPAWNED',
  'AGENT_STARTED',
  'AGENT_STOPPED',
  'AGENT_FAILED',
  'AGENT_COMPLETED',
  'AGENT_MESSAGE',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_STARTED',
  'TASK_COMPLETED',
  'TASK_FAILED',
  'TASK_RETRY',
  'TASK_REVIEW',
  'TASK_BLOCKED',
  'TASK_CANCELLED',
  'EXECUTION_STARTED',
  'EXECUTION_OUTPUT',
  'EXECUTION_COMPLETED',
  'EXECUTION_FAILED',
  'TOOL_STARTED',
  'TOOL_COMPLETED',
  'TOOL_FAILED',
  'TOOL_DENIED',
  'JUDGE_STARTED',
  'JUDGE_APPROVED',
  'JUDGE_REJECTED',
  'JUDGE_ESCALATED',
  'SCHEDULE_CREATED',
  'SCHEDULE_TRIGGERED',
  'APPROVAL_REQUESTED',
  'APPROVAL_RESOLVED',
  'WATCHDOG_ALERT',
  'WATCHDOG_ACTION',
  'BUDGET_WARNING',
  'BUDGET_EXCEEDED',
  'MEMORY_WRITTEN',
  'WORKFLOW_STARTED',
  'WORKFLOW_NODE_STARTED',
  'WORKFLOW_NODE_COMPLETED',
  'WORKFLOW_NODE_FAILED',
  'WORKFLOW_COMPLETED',
  'WORKFLOW_FAILED',
  'GIT_ACTION',
  'CONSOLE_OUTPUT',
  'CONSOLE_EXIT',
  'SYSTEM'
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type EventLevel = (typeof EVENT_LEVELS)[number]

export interface AcceptanceCriterion {
  id: string
  text: string
  weight?: number
  met?: boolean | null
  evidence?: string
}

export interface RubricDimension {
  name: string
  weight: number
  description?: string
}

export const DEFAULT_RUBRIC_DIMENSIONS: RubricDimension[] = [
  { name: 'Correctness', weight: 0.3, description: 'The work does what was asked, without defects.' },
  { name: 'Completeness', weight: 0.2, description: 'Nothing required was left out.' },
  { name: 'Tests', weight: 0.15, description: 'Verification exists and passes.' },
  { name: 'Quality', weight: 0.15, description: 'Clear, maintainable, idiomatic.' },
  { name: 'Security', weight: 0.1, description: 'No unsafe handling of data, secrets or input.' },
  { name: 'Performance', weight: 0.05, description: 'No obvious inefficiency.' },
  { name: 'Requirements', weight: 0.05, description: 'Acceptance criteria are satisfied.' }
]

export interface CriterionScore {
  name: string
  score: number
  reason: string
}

export interface JudgeVerdict {
  score: number
  decision: JudgeDecision
  criteria: CriterionScore[]
  issues: string[]
  requiredChanges: string[]
  summary: string
  criteriaChecklist?: AcceptanceCriterion[]
}

export interface RetryPolicy {
  maxRetries: number
  backoffMs: number
  backoffFactor: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  backoffMs: 5_000,
  backoffFactor: 2
}

/**
 * Recursion and resource safety. Defaults are deliberately conservative; the
 * user raises them explicitly per project.
 */
export interface SafetyLimits {
  maxDepth: number
  maxChildrenPerAgent: number
  maxTotalAgents: number
  maxConcurrentExecutions: number
  maxIterationsPerExecution: number
  maxRuntimeMsPerExecution: number
  maxToolCallsPerExecution: number
  maxCostUsdPerTask: number
  maxCostUsdPerProject: number
  maxTasksPerProject: number
  maxRevisionsPerTask: number
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxDepth: 4,
  maxChildrenPerAgent: 6,
  maxTotalAgents: 40,
  maxConcurrentExecutions: 4,
  maxIterationsPerExecution: 40,
  maxRuntimeMsPerExecution: 15 * 60_000,
  maxToolCallsPerExecution: 120,
  maxCostUsdPerTask: 2,
  maxCostUsdPerProject: 25,
  maxTasksPerProject: 500,
  maxRevisionsPerTask: 3
}

export interface ProjectSettings {
  limits: SafetyLimits
  defaultProvider: string
  defaultModel: string
  judgeModel?: string
  judgePassThreshold: number
  judgeEscalateThreshold: number
  autoJudge: boolean
  autoRevise: boolean
  requireApprovalFor: Permission[]
  /** Give each agent its own git worktree so parallel work cannot collide. */
  isolateAgentWorkspaces: boolean
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  limits: DEFAULT_SAFETY_LIMITS,
  defaultProvider: 'claude-code',
  defaultModel: 'sonnet',
  judgePassThreshold: 0.8,
  judgeEscalateThreshold: 0.3,
  autoJudge: true,
  autoRevise: true,
  requireApprovalFor: ['SHELL_EXECUTE', 'AGENT_DELETE', 'PROJECT_DELETE', 'EXTERNAL_API'],
  isolateAgentWorkspaces: false
}

export interface InvokeAgentResult {
  status: 'completed' | 'failed' | 'blocked'
  summary: string
  artifacts: Array<{ id: string; title: string; path?: string }>
  issues: string[]
  score: number | null
  taskId: string
  executionId: string
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  costUsd: number
  toolCalls: number
  durationMs: number
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, durationMs: 0 }
}
