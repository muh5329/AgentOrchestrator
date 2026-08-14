import type { DB } from '../db/client'
import type { EventBus } from './event-bus'
import type { ProjectService } from '../services/project-service'
import type { AgentService } from '../services/agent-service'
import type { TaskService } from '../services/task-service'
import type { ToolService } from '../services/tool-service'
import type { MemoryService } from '../services/memory-service'
import type { MessageService } from '../services/message-service'
import type { ApprovalService } from '../services/approval-service'
import type { BudgetService } from '../services/budget-service'
import type { ScheduleService } from '../services/schedule-service'
import type { EvaluationService } from '../services/evaluation-service'
import type { ArtifactService } from '../services/artifact-service'
import type { ProviderRegistry } from '../runtime/provider-registry'
import type { ToolRuntime } from '../runtime/tool-runtime'
import type { AgentRuntime } from '../runtime/agent-runtime'
import type { ExecutionManager } from '../engines/execution-manager'
import type { Scheduler } from '../engines/scheduler'
import type { JudgeEngine } from '../engines/judge-engine'
import type { WatchdogEngine } from '../engines/watchdog-engine'
import type { OrchestratorService } from '../services/orchestrator-service'
import type { WorkflowService } from '../services/workflow-service'
import type { WorkflowEngine } from '../engines/workflow-engine'
import type { GitService } from '../services/git-service'
import type { WorkspaceService } from '../services/workspace-service'
import type { ControlServer } from '../runtime/mcp/control-server'

export interface AppPaths {
  userData: string
  dbFile: string
  migrations: string
  workspaces: string
  bridgeEntry: string
}

export interface AppContext {
  db: DB
  bus: EventBus
  paths: AppPaths
  projects: ProjectService
  agents: AgentService
  tasks: TaskService
  tools: ToolService
  memory: MemoryService
  messages: MessageService
  approvals: ApprovalService
  budgets: BudgetService
  schedules: ScheduleService
  evaluations: EvaluationService
  artifacts: ArtifactService
  providers: ProviderRegistry
  toolRuntime: ToolRuntime
  runtime: AgentRuntime
  executor: ExecutionManager
  scheduler: Scheduler
  judge: JudgeEngine
  watchdog: WatchdogEngine
  orchestrator: OrchestratorService
  workflows: WorkflowService
  workflowEngine: WorkflowEngine
  git: GitService
  workspace: WorkspaceService
  control: ControlServer
}
