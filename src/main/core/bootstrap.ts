import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { openDatabase, type DatabaseHandle } from '../db/client'
import { EventBus } from './event-bus'
import type { AppContext, AppPaths } from './context'
import { ProjectService } from '../services/project-service'
import { AgentService } from '../services/agent-service'
import { TaskService } from '../services/task-service'
import { ToolService } from '../services/tool-service'
import { MemoryService } from '../services/memory-service'
import { MessageService } from '../services/message-service'
import { ApprovalService } from '../services/approval-service'
import { BudgetService } from '../services/budget-service'
import { ScheduleService } from '../services/schedule-service'
import { EvaluationService } from '../services/evaluation-service'
import { ArtifactService } from '../services/artifact-service'
import { OrchestratorService } from '../services/orchestrator-service'
import { WorkflowService } from '../services/workflow-service'
import { WorkflowEngine } from '../engines/workflow-engine'
import { GitService } from '../services/git-service'
import { WorkspaceService } from '../services/workspace-service'
import { ProviderRegistry } from '../runtime/provider-registry'
import { ToolRuntime } from '../runtime/tool-runtime'
import { AgentRuntime } from '../runtime/agent-runtime'
import { ControlServer } from '../runtime/mcp/control-server'
import { ExecutionManager, type ExecutionManagerOptions } from '../engines/execution-manager'
import { Scheduler } from '../engines/scheduler'
import { JudgeEngine } from '../engines/judge-engine'
import { WatchdogEngine } from '../engines/watchdog-engine'
import { ClaudeCodeAdapter } from '../runtime/providers/claude-code'
import { AnthropicApiAdapter } from '../runtime/providers/anthropic-api'
import { ScriptedAdapter } from '../runtime/providers/scripted'

export interface BootstrapOptions {
  userData: string
  dbFile?: string
  migrations: string
  bridgeEntry?: string
  nodeExecPath?: string
  /**
   * The deterministic provider is opt-in. It exists for tests and dry runs and
   * must never quietly stand in for a real model.
   */
  enableScriptedProvider?: boolean
  startEngines?: boolean
  executor?: ExecutionManagerOptions
  schedulerTickMs?: number
  watchdogIntervalMs?: number
}

export interface BootstrappedApp {
  ctx: AppContext
  handle: DatabaseHandle
  start(): Promise<void>
  close(): Promise<void>
}

/**
 * Composition root.
 *
 * Deliberately free of Electron imports so the entire backend can be started,
 * exercised and torn down inside a test process.
 */
export function bootstrap(options: BootstrapOptions): BootstrappedApp {
  const dbFile = options.dbFile ?? path.join(options.userData, 'agent-orchestrator.db')
  const workspaces = path.join(options.userData, 'workspaces')
  if (dbFile !== ':memory:') mkdirSync(path.dirname(dbFile), { recursive: true })
  mkdirSync(workspaces, { recursive: true })

  const handle = openDatabase(dbFile, options.migrations)

  const paths: AppPaths = {
    userData: options.userData,
    dbFile,
    migrations: options.migrations,
    workspaces,
    bridgeEntry: options.bridgeEntry ?? ''
  }

  // Services are constructed against a context object that is filled in as we
  // go; every service holds the reference, not the individual dependencies.
  const ctx = { db: handle.db, paths } as AppContext
  ctx.bus = new EventBus(handle.db)
  ctx.projects = new ProjectService(ctx)
  ctx.agents = new AgentService(ctx)
  ctx.tasks = new TaskService(ctx)
  ctx.tools = new ToolService(ctx)
  ctx.memory = new MemoryService(ctx)
  ctx.messages = new MessageService(ctx)
  ctx.approvals = new ApprovalService(ctx)
  ctx.budgets = new BudgetService(ctx)
  ctx.schedules = new ScheduleService(ctx)
  ctx.evaluations = new EvaluationService(ctx)
  ctx.artifacts = new ArtifactService(ctx)
  ctx.orchestrator = new OrchestratorService(ctx)
  ctx.workflows = new WorkflowService(ctx)
  ctx.git = new GitService(ctx)
  ctx.workspace = new WorkspaceService(ctx)
  ctx.providers = new ProviderRegistry(ctx)
  ctx.toolRuntime = new ToolRuntime(ctx)
  ctx.runtime = new AgentRuntime(ctx)
  ctx.control = new ControlServer(ctx)
  ctx.executor = new ExecutionManager(ctx, options.executor)
  ctx.scheduler = new Scheduler(ctx, { tickMs: options.schedulerTickMs })
  ctx.judge = new JudgeEngine(ctx)
  ctx.watchdog = new WatchdogEngine(ctx, { intervalMs: options.watchdogIntervalMs })
  ctx.workflowEngine = new WorkflowEngine(ctx)

  ctx.tools.seedBuiltins()

  ctx.providers.register(
    new ClaudeCodeAdapter({
      bridgeEntry: paths.bridgeEntry,
      controlUrl: () => ctx.control.url,
      controlToken: ctx.control.secret,
      nodeExecPath: options.nodeExecPath ?? process.execPath
    })
  )
  ctx.providers.register(
    new AnthropicApiAdapter(() => ctx.providers.getSecret('anthropic.apiKey'))
  )
  if (options.enableScriptedProvider) {
    ctx.providers.register(new ScriptedAdapter())
  }

  // Provider availability is probed in the background; close() waits for it so
  // a slow CLI check can never write to a database that has already shut down.
  let providerCheck: Promise<unknown> = Promise.resolve()

  return {
    ctx,
    handle,
    async start() {
      await ctx.control.start()
      const interrupted = ctx.tasks.recoverInterrupted()
      if (interrupted) {
        ctx.bus.emit({
          type: 'SYSTEM',
          level: 'warn',
          message: `Requeued ${interrupted} task${interrupted === 1 ? '' : 's'} interrupted by a restart`,
          data: { interrupted }
        })
      }
      providerCheck = ctx.providers.checkAll().catch((err) => {
        console.error('[bootstrap] provider check failed', err)
      })
      if (options.startEngines !== false) {
        ctx.scheduler.start()
        ctx.executor.start()
        ctx.watchdog.start()
        ctx.workflowEngine.start()
      }
    },
    async close() {
      await providerCheck
      ctx.workspace.stopAll()
      ctx.workflowEngine.stop()
      ctx.watchdog.stop()
      ctx.scheduler.stop()
      await ctx.executor.stop()
      await ctx.control.stop()
      handle.close()
    }
  }
}
