import vm from 'node:vm'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppContext } from '../core/context'
import { AppError } from '../core/errors'
import type { WorkflowEdgeRow, WorkflowNodeRow } from '../db/schema'
import type { WorkflowNodeConfig, WorkflowNodeKind } from '../../shared/workflow'
import { id } from '../util/id'
import { now, sleep } from '../util/time'
import type { ToolInvocation } from '../runtime/tools/types'

export interface RunWorkflowOptions {
  trigger?: string
  variables?: Record<string, unknown>
  signal?: AbortSignal
  /** Agent that asked for this run, if any - used for tool permissions. */
  callerAgentId?: string | null
}

export interface WorkflowRunResult {
  runId: string
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED'
  steps: number
  context: Record<string, unknown>
  error?: string
}

interface RunState {
  runId: string
  workflowId: string
  projectId: string
  vars: Record<string, unknown>
  results: Record<string, unknown>
  steps: number
  signal: AbortSignal
  callerAgentId: string | null
}

/** Beyond this many node executions a workflow is looping, not working. */
const MAX_STEPS = 500

/**
 * Interprets a workflow graph.
 *
 * Every node kind here corresponds to something the rest of the system already
 * does - running an agent, calling a tool, asking the Judge, waiting for a
 * human. The engine is the wiring, not a second implementation: an `agent` node
 * goes through the same executor as a delegated task, so limits, budgets,
 * judging and events all behave identically.
 */
export class WorkflowEngine {
  private readonly running = new Map<string, AbortController>()
  private readonly unsubscribes: Array<() => void> = []

  constructor(private readonly ctx: AppContext) {}

  /** Subscribes event-triggered workflows to the bus. */
  start(): void {
    if (this.unsubscribes.length) return
    this.unsubscribes.push(
      this.ctx.bus.on('*', (event) => {
        if (!event.projectId) return
        if (event.type.startsWith('WORKFLOW_')) return
        for (const workflow of this.ctx.workflows.byEvent(event.projectId, event.type)) {
          void this.run(workflow.id, {
            trigger: `event:${event.type}`,
            variables: { event: { type: event.type, message: event.message, data: event.data } }
          }).catch(() => undefined)
        }
      })
    )
  }

  stop(): void {
    for (const off of this.unsubscribes.splice(0)) off()
    for (const controller of this.running.values()) controller.abort()
  }

  cancel(runId: string): boolean {
    const controller = this.running.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async run(workflowId: string, options: RunWorkflowOptions = {}): Promise<WorkflowRunResult> {
    const { workflow, nodes, edges } = this.ctx.workflows.graph(workflowId)

    const issues = this.ctx.workflows.validate(workflowId).filter((i) => i.severity === 'error')
    if (issues.length) {
      throw new AppError(
        `Workflow "${workflow.name}" is not runnable: ${issues.map((i) => i.message).join(' ')}`,
        'INVALID_WORKFLOW',
        { issues }
      )
    }

    const start = nodes.find((n) => n.kind === 'start')
    if (!start) throw new AppError('The workflow has no Start node.', 'INVALID_WORKFLOW')

    const run = this.ctx.workflows.createRun({
      workflowId,
      projectId: workflow.projectId,
      trigger: options.trigger ?? 'manual',
      context: { ...workflow.variables, ...(options.variables ?? {}) }
    })

    const controller = new AbortController()
    if (options.signal) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    this.running.set(run.id, controller)

    const state: RunState = {
      runId: run.id,
      workflowId,
      projectId: workflow.projectId,
      vars: { ...workflow.variables, ...(options.variables ?? {}) },
      results: {},
      steps: 0,
      signal: controller.signal,
      callerAgentId: options.callerAgentId ?? null
    }

    this.ctx.bus.emit({
      type: 'WORKFLOW_STARTED',
      projectId: workflow.projectId,
      message: `Workflow "${workflow.name}" started`,
      data: { workflowId, runId: run.id, trigger: state.vars ? options.trigger : 'manual' }
    })

    const graph = new Graph(nodes, edges)

    try {
      // Walk from the Start node itself, not its successor, so the run
      // timeline shows where it began.
      await this.walk(start.id, graph, state, new Set())
      const status = controller.signal.aborted ? 'CANCELLED' : 'COMPLETED'
      this.ctx.workflows.finishRun(run.id, status, {
        context: { vars: state.vars, results: state.results },
        steps: state.steps
      })
      this.ctx.bus.emit({
        type: status === 'COMPLETED' ? 'WORKFLOW_COMPLETED' : 'WORKFLOW_FAILED',
        projectId: workflow.projectId,
        level: status === 'COMPLETED' ? 'info' : 'warn',
        message: `Workflow "${workflow.name}" ${status.toLowerCase()} after ${state.steps} steps`,
        data: { workflowId, runId: run.id }
      })
      return { runId: run.id, status, steps: state.steps, context: state.vars }
    } catch (err) {
      const message = (err as Error).message
      this.ctx.workflows.finishRun(run.id, 'FAILED', {
        error: message,
        context: { vars: state.vars, results: state.results },
        steps: state.steps
      })
      this.ctx.bus.emit({
        type: 'WORKFLOW_FAILED',
        projectId: workflow.projectId,
        level: 'error',
        message: `Workflow "${workflow.name}" failed: ${message}`,
        data: { workflowId, runId: run.id, error: message }
      })
      return {
        runId: run.id,
        status: 'FAILED',
        steps: state.steps,
        context: state.vars,
        error: message
      }
    } finally {
      this.running.delete(run.id)
    }
  }

  /**
   * Executes nodes in sequence from `nodeId`, stopping when it reaches a node in
   * `stopAt` (whose id it returns) or runs out of graph (returns null).
   */
  private async walk(
    nodeId: string | null,
    graph: Graph,
    state: RunState,
    stopAt: Set<string>
  ): Promise<string | null> {
    let current = nodeId

    while (current) {
      if (state.signal.aborted) throw new Error('Workflow cancelled')
      if (stopAt.has(current)) return current
      if (++state.steps > MAX_STEPS) {
        throw new Error(`Workflow exceeded ${MAX_STEPS} steps; it is looping rather than finishing.`)
      }

      const node = graph.node(current)
      if (!node) return null
      if (node.kind === 'end') return null

      current = await this.executeNode(node, graph, state, stopAt)
    }
    return null
  }

  private async executeNode(
    node: WorkflowNodeRow,
    graph: Graph,
    state: RunState,
    stopAt: Set<string>
  ): Promise<string | null> {
    const config = (node.config ?? {}) as WorkflowNodeConfig
    const nodeRunId = this.ctx.workflows.startNodeRun({
      runId: state.runId,
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
      iteration: 0
    })

    this.ctx.bus.emit({
      type: 'WORKFLOW_NODE_STARTED',
      projectId: state.projectId,
      level: 'debug',
      message: `${node.label} (${node.kind})`,
      data: { runId: state.runId, nodeId: node.id, kind: node.kind },
      persist: false
    })

    try {
      const outcome = await this.dispatch(node, config, graph, state, stopAt)
      this.ctx.workflows.finishNodeRun(nodeRunId, 'COMPLETED', { output: outcome.output ?? null })
      if (config.saveAs && outcome.output !== undefined) {
        state.vars[config.saveAs] = outcome.output
      }
      state.results[node.id] = outcome.output ?? null

      this.ctx.bus.emit({
        type: 'WORKFLOW_NODE_COMPLETED',
        projectId: state.projectId,
        level: 'debug',
        message: `${node.label} → ${outcome.summary ?? 'ok'}`,
        data: { runId: state.runId, nodeId: node.id },
        persist: false
      })

      return outcome.next !== undefined ? outcome.next : graph.next(node.id)
    } catch (err) {
      const message = (err as Error).message
      this.ctx.workflows.finishNodeRun(nodeRunId, 'FAILED', { error: message })
      this.ctx.bus.emit({
        type: 'WORKFLOW_NODE_FAILED',
        projectId: state.projectId,
        level: 'warn',
        message: `${node.label} failed: ${message}`,
        data: { runId: state.runId, nodeId: node.id }
      })
      throw err
    }
  }

  private async dispatch(
    node: WorkflowNodeRow,
    config: WorkflowNodeConfig,
    graph: Graph,
    state: RunState,
    stopAt: Set<string>
  ): Promise<{ output?: unknown; next?: string | null; summary?: string }> {
    switch (node.kind as WorkflowNodeKind) {
      case 'start':
      case 'merge':
        return { summary: 'continue' }

      case 'delay': {
        const ms = Math.max(0, Number(config.ms ?? 1000))
        await sleep(ms, state.signal)
        return { summary: `waited ${ms}ms` }
      }

      case 'agent': {
        const agent = this.ctx.agents.resolve(state.projectId, this.template(String(config.agent), state))
        const task = this.ctx.tasks.create({
          projectId: state.projectId,
          agentId: agent.id,
          title: this.template(String(config.task ?? node.label), state).slice(0, 120),
          description: this.template(String(config.task ?? ''), state),
          acceptanceCriteria: (config.acceptanceCriteria ?? []).map((c) => this.template(c, state)),
          requiresJudge: config.judge === true,
          priority: Number(config.priority ?? 60),
          status: 'READY',
          context: { workflowRunId: state.runId, workflowNodeId: node.id }
        })
        const result = await this.ctx.executor.runTaskNow(task.id, { signal: state.signal })
        return {
          output: { taskId: task.id, status: result.status, summary: result.summary, score: result.score },
          summary: `${agent.name}: ${result.status}`
        }
      }

      case 'task': {
        const agent = config.agent
          ? this.ctx.agents.resolve(state.projectId, this.template(String(config.agent), state))
          : null
        const task = this.ctx.tasks.create({
          projectId: state.projectId,
          agentId: agent?.id ?? null,
          title: this.template(String(config.title ?? node.label), state),
          description: this.template(String(config.description ?? ''), state),
          acceptanceCriteria: (config.acceptanceCriteria ?? []).map((c) => this.template(c, state)),
          priority: Number(config.priority ?? 50),
          requiresJudge: config.judge !== false,
          status: agent ? 'READY' : 'BACKLOG',
          context: { workflowRunId: state.runId, workflowNodeId: node.id }
        })
        if (config.wait === true && agent) {
          const result = await this.ctx.executor.runTaskNow(task.id, { signal: state.signal })
          return { output: { ...result, taskId: task.id }, summary: result.status }
        }
        return { output: { taskId: task.id }, summary: 'queued' }
      }

      case 'tool': {
        const agent = this.ctx.agents.resolve(
          state.projectId,
          this.template(String(config.agent ?? ''), state)
        )
        const invocation = await this.toolInvocation(state, agent.id, node.id)
        const input = this.templateDeep(config.input ?? {}, state) as Record<string, unknown>
        const result = await this.ctx.toolRuntime.call({
          name: String(config.tool),
          input,
          invocation
        })
        if (!result.ok) throw new Error(`Tool "${config.tool}" failed: ${result.content}`)
        return { output: result.content, summary: 'ok' }
      }

      case 'judge': {
        const taskId = this.resolveTaskId(config, state)
        if (!taskId) throw new Error('The judge node could not determine which task to evaluate.')
        const verdict = await this.ctx.judge.evaluate(taskId, {
          apply: true,
          signal: state.signal
        })
        return {
          output: { decision: verdict.decision, score: verdict.score, summary: verdict.summary },
          summary: `${verdict.decision} ${Math.round(verdict.score * 100)}%`
        }
      }

      case 'condition': {
        const value = this.evaluate(String(config.expression ?? 'false'), state)
        const branch = value ? 'true' : 'false'
        return {
          output: value,
          next: graph.next(node.id, branch),
          summary: branch
        }
      }

      case 'approval': {
        const approval = this.ctx.approvals.request({
          projectId: state.projectId,
          agentId: state.callerAgentId,
          action: this.template(String(config.action ?? node.label), state),
          reason: this.template(String(config.reason ?? 'A workflow paused for your decision.'), state),
          payload: { runId: state.runId, nodeId: node.id }
        })
        const outcome = await this.ctx.approvals.wait(approval.id, 24 * 3_600_000, state.signal)
        const approved = outcome.status === 'APPROVED'
        const branch = approved ? 'approved' : 'denied'
        const next = graph.next(node.id, branch)
        return {
          output: { status: outcome.status, resolution: outcome.resolution },
          // With no explicit branch wired, a denial stops the run rather than
          // silently carrying on as though it were approved.
          next: next ?? (approved ? graph.next(node.id) : null),
          summary: outcome.status
        }
      }

      case 'webhook': {
        const url = this.template(String(config.url ?? ''), state)
        if (!/^https?:\/\//i.test(url)) throw new Error(`"${url}" is not an http(s) URL.`)
        const method = String(config.method ?? 'GET').toUpperCase()
        const response = await fetch(url, {
          method,
          signal: state.signal,
          headers: { 'content-type': 'application/json' },
          body:
            method === 'GET' || method === 'HEAD'
              ? undefined
              : this.template(String(config.body ?? '{}'), state)
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}: ${text.slice(0, 300)}`)
        return { output: safeJson(text), summary: `HTTP ${response.status}` }
      }

      case 'parallel': {
        const branches = graph.outgoing(node.id)
        const merge = graph.findMerge(node.id)
        const stops = new Set(stopAt)
        if (merge) stops.add(merge)

        const settled = await Promise.allSettled(
          branches.map((edge) => this.walk(edge.toNodeId, graph, state, stops))
        )
        const failures = settled.filter((s) => s.status === 'rejected')
        if (failures.length) {
          throw new Error(
            `${failures.length} of ${branches.length} parallel branches failed: ` +
              failures
                .map((f) => ((f as PromiseRejectedResult).reason as Error).message)
                .join('; ')
          )
        }
        return { next: merge, summary: `${branches.length} branches` }
      }

      case 'loop': {
        const max = Math.max(1, Number(config.maxIterations ?? 5))
        const bodyStart = graph.next(node.id, 'body')
        const stops = new Set(stopAt)
        stops.add(node.id)

        let iterations = 0
        while (iterations < max) {
          if (state.signal.aborted) throw new Error('Workflow cancelled')
          state.vars.iteration = iterations
          if (config.expression && !this.evaluate(String(config.expression), state)) break
          iterations += 1
          await this.walk(bodyStart, graph, state, stops)
          if (!config.expression) break
        }
        state.vars.iterations = iterations
        return { output: { iterations }, next: graph.next(node.id, 'done'), summary: `${iterations}x` }
      }

      default:
        throw new Error(`Unknown workflow node kind: ${node.kind}`)
    }
  }

  private resolveTaskId(config: WorkflowNodeConfig, state: RunState): string | null {
    if (config.taskId) {
      const templated = this.template(String(config.taskId), state)
      if (templated) return templated
    }
    // Fall back to the most recent task any node in this run produced.
    for (const value of Object.values(state.results).reverse()) {
      if (value && typeof value === 'object' && 'taskId' in (value as Record<string, unknown>)) {
        return String((value as Record<string, unknown>).taskId)
      }
    }
    return null
  }

  /** A tool node borrows an agent's identity, so permissions still apply. */
  private async toolInvocation(
    state: RunState,
    agentId: string,
    nodeId: string
  ): Promise<ToolInvocation> {
    const project = this.ctx.projects.get(state.projectId)
    const workspaceDir = project.rootPath ?? path.join(this.ctx.paths.workspaces, project.id)
    await fs.mkdir(workspaceDir, { recursive: true })

    return {
      ctx: this.ctx,
      projectId: state.projectId,
      agentId,
      taskId: null,
      executionId: `${state.runId}:${nodeId}:${id('inv')}`,
      depth: 0,
      signal: state.signal,
      workspaceDir,
      spawnedAgents: [],
      finish: () => undefined
    }
  }

  /** `{{var}}` substitution against the run context. */
  private template(text: string, state: RunState): string {
    return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
      const value = key.split('.').reduce<unknown>((acc, part) => {
        if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
        return undefined
      }, state.vars)
      if (value === undefined || value === null) return ''
      return typeof value === 'string' ? value : JSON.stringify(value)
    })
  }

  private templateDeep(value: unknown, state: RunState): unknown {
    if (typeof value === 'string') return this.template(value, state)
    if (Array.isArray(value)) return value.map((v) => this.templateDeep(v, state))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.templateDeep(v, state)])
      )
    }
    return value
  }

  /** Sandboxed expression evaluation - no require, no process, hard timeout. */
  private evaluate(expression: string, state: RunState): boolean {
    try {
      const sandbox = { vars: state.vars, results: state.results, JSON, Math }
      const value = vm.runInNewContext(`(${expression})`, sandbox, { timeout: 500 })
      return Boolean(value)
    } catch (err) {
      throw new Error(`Condition "${expression}" could not be evaluated: ${(err as Error).message}`)
    }
  }
}

/** Adjacency helper over a workflow's nodes and edges. */
class Graph {
  private readonly byId = new Map<string, WorkflowNodeRow>()
  private readonly out = new Map<string, WorkflowEdgeRow[]>()

  constructor(nodes: WorkflowNodeRow[], edges: WorkflowEdgeRow[]) {
    for (const node of nodes) this.byId.set(node.id, node)
    for (const edge of edges) {
      this.out.set(edge.fromNodeId, [...(this.out.get(edge.fromNodeId) ?? []), edge])
    }
  }

  node(nodeId: string): WorkflowNodeRow | undefined {
    return this.byId.get(nodeId)
  }

  outgoing(nodeId: string): WorkflowEdgeRow[] {
    return this.out.get(nodeId) ?? []
  }

  /** The next node along an optionally-labelled branch. */
  next(nodeId: string, label?: string): string | null {
    const edges = this.outgoing(nodeId)
    if (label) {
      const match = edges.find((e) => e.label === label)
      return match ? match.toNodeId : null
    }
    const unlabelled = edges.find((e) => !e.label) ?? edges[0]
    return unlabelled ? unlabelled.toNodeId : null
  }

  /** First merge node reachable from every branch of a parallel node. */
  findMerge(nodeId: string): string | null {
    const seen = new Set<string>()
    const queue = this.outgoing(nodeId).map((e) => e.toNodeId)
    while (queue.length) {
      const current = queue.shift() as string
      if (seen.has(current)) continue
      seen.add(current)
      if (this.byId.get(current)?.kind === 'merge') return current
      for (const edge of this.outgoing(current)) queue.push(edge.toNodeId)
    }
    return null
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text.slice(0, 20_000)
  }
}

export const __testing = { Graph, MAX_STEPS, now }
