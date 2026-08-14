import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { AppError, NotFoundError } from '../core/errors'
import {
  workflowEdges,
  workflowNodeRuns,
  workflowNodes,
  workflowRuns,
  workflows,
  type WorkflowEdgeRow,
  type WorkflowNodeRow,
  type WorkflowNodeRunRow,
  type WorkflowRow,
  type WorkflowRunRow
} from '../db/schema'
import {
  validateWorkflow,
  type WorkflowNodeConfig,
  type WorkflowNodeKind
} from '../../shared/workflow'
import { id } from '../util/id'
import { now } from '../util/time'

export interface WorkflowGraph {
  workflow: WorkflowRow
  nodes: WorkflowNodeRow[]
  edges: WorkflowEdgeRow[]
}

export interface SaveGraphInput {
  workflowId: string
  nodes: Array<{
    id?: string
    kind: WorkflowNodeKind
    label: string
    config: WorkflowNodeConfig
    x: number
    y: number
  }>
  edges: Array<{ id?: string; fromNodeId: string; toNodeId: string; label?: string | null }>
}

export class WorkflowService {
  constructor(private readonly ctx: AppContext) {}

  create(input: {
    projectId: string
    name: string
    description?: string
    trigger?: string
    eventType?: string | null
  }): WorkflowRow {
    const workflowId = id('wfl')
    const ts = now()
    this.ctx.db
      .insert(workflows)
      .values({
        id: workflowId,
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? '',
        trigger: input.trigger ?? 'manual',
        eventType: input.eventType ?? null,
        createdAt: ts,
        updatedAt: ts
      })
      .run()

    // A workflow with nowhere to begin is not useful; seed the start node.
    this.ctx.db
      .insert(workflowNodes)
      .values({
        id: id('wfn'),
        workflowId,
        kind: 'start',
        label: 'Start',
        config: {},
        x: 80,
        y: 80
      })
      .run()

    this.ctx.bus.emit({
      type: 'SYSTEM',
      projectId: input.projectId,
      message: `Workflow "${input.name}" created`,
      data: { workflowId }
    })
    return this.get(workflowId)
  }

  get(workflowId: string): WorkflowRow {
    const row = this.ctx.db.select().from(workflows).where(eq(workflows.id, workflowId)).get()
    if (!row) throw new NotFoundError('Workflow', workflowId)
    return row
  }

  list(projectId: string): WorkflowRow[] {
    return this.ctx.db
      .select()
      .from(workflows)
      .where(eq(workflows.projectId, projectId))
      .orderBy(desc(workflows.updatedAt))
      .all()
  }

  byEvent(projectId: string, eventType: string): WorkflowRow[] {
    return this.ctx.db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.projectId, projectId),
          eq(workflows.enabled, true),
          eq(workflows.trigger, 'event'),
          eq(workflows.eventType, eventType)
        )
      )
      .all()
  }

  graph(workflowId: string): WorkflowGraph {
    return {
      workflow: this.get(workflowId),
      nodes: this.ctx.db
        .select()
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, workflowId))
        .all(),
      edges: this.ctx.db
        .select()
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, workflowId))
        .all()
    }
  }

  update(workflowId: string, patch: Partial<WorkflowRow>): WorkflowRow {
    this.get(workflowId)
    this.ctx.db
      .update(workflows)
      .set({ ...patch, updatedAt: now() })
      .where(eq(workflows.id, workflowId))
      .run()
    return this.get(workflowId)
  }

  delete(workflowId: string): void {
    this.ctx.db.delete(workflows).where(eq(workflows.id, workflowId)).run()
  }

  /**
   * Replaces the graph wholesale. The builder always sends the full picture, so
   * a diff-based update would only add ways for the two to disagree.
   */
  saveGraph(input: SaveGraphInput): WorkflowGraph {
    const workflow = this.get(input.workflowId)

    const issues = validateWorkflow({
      nodes: input.nodes.map((n) => ({
        id: n.id ?? 'new',
        kind: n.kind,
        label: n.label,
        config: n.config
      })),
      edges: input.edges.map((e) => ({
        id: e.id ?? 'new',
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        label: e.label
      }))
    })
    const blocking = issues.filter((i) => i.severity === 'error')
    if (blocking.length) {
      throw new AppError(
        `This workflow cannot be saved yet: ${blocking.map((i) => i.message).join(' ')}`,
        'INVALID_WORKFLOW',
        { issues }
      )
    }

    this.ctx.db.delete(workflowEdges).where(eq(workflowEdges.workflowId, input.workflowId)).run()
    this.ctx.db.delete(workflowNodes).where(eq(workflowNodes.workflowId, input.workflowId)).run()

    for (const node of input.nodes) {
      this.ctx.db
        .insert(workflowNodes)
        .values({
          id: node.id ?? id('wfn'),
          workflowId: input.workflowId,
          kind: node.kind,
          label: node.label,
          config: node.config,
          x: Math.round(node.x),
          y: Math.round(node.y)
        })
        .run()
    }
    for (const edge of input.edges) {
      this.ctx.db
        .insert(workflowEdges)
        .values({
          id: edge.id ?? id('wfe'),
          workflowId: input.workflowId,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          label: edge.label ?? null
        })
        .run()
    }

    this.ctx.db
      .update(workflows)
      .set({ updatedAt: now() })
      .where(eq(workflows.id, input.workflowId))
      .run()

    this.ctx.bus.emit({
      type: 'SYSTEM',
      projectId: workflow.projectId,
      message: `Workflow "${workflow.name}" updated`,
      data: { workflowId: input.workflowId, nodes: input.nodes.length, edges: input.edges.length }
    })

    return this.graph(input.workflowId)
  }

  validate(workflowId: string) {
    const graph = this.graph(workflowId)
    return validateWorkflow({
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        kind: n.kind as WorkflowNodeKind,
        label: n.label,
        config: n.config as WorkflowNodeConfig
      })),
      edges: graph.edges.map((e) => ({
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        label: e.label
      }))
    })
  }

  /* ---------------------------- runs ---------------------------- */

  createRun(input: {
    workflowId: string
    projectId: string
    trigger: string
    context: Record<string, unknown>
  }): WorkflowRunRow {
    const runId = id('wfr')
    this.ctx.db
      .insert(workflowRuns)
      .values({
        id: runId,
        workflowId: input.workflowId,
        projectId: input.projectId,
        status: 'RUNNING',
        trigger: input.trigger,
        context: input.context,
        startedAt: now()
      })
      .run()
    return this.getRun(runId)
  }

  getRun(runId: string): WorkflowRunRow {
    return this.ctx.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).get()!
  }

  finishRun(
    runId: string,
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
    patch: { error?: string | null; context?: Record<string, unknown>; steps?: number } = {}
  ): WorkflowRunRow {
    this.ctx.db
      .update(workflowRuns)
      .set({ status, endedAt: now(), ...patch })
      .where(eq(workflowRuns.id, runId))
      .run()
    return this.getRun(runId)
  }

  listRuns(workflowId: string, limit = 50): WorkflowRunRow[] {
    return this.ctx.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit)
      .all()
  }

  listProjectRuns(projectId: string, limit = 50): WorkflowRunRow[] {
    return this.ctx.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.projectId, projectId))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit)
      .all()
  }

  startNodeRun(input: {
    runId: string
    nodeId: string
    kind: string
    label: string
    iteration: number
  }): string {
    const nodeRunId = id('wnr')
    this.ctx.db
      .insert(workflowNodeRuns)
      .values({
        id: nodeRunId,
        runId: input.runId,
        nodeId: input.nodeId,
        kind: input.kind,
        label: input.label,
        status: 'RUNNING',
        iteration: input.iteration,
        startedAt: now()
      })
      .run()
    return nodeRunId
  }

  finishNodeRun(
    nodeRunId: string,
    status: 'COMPLETED' | 'FAILED' | 'SKIPPED',
    patch: { output?: unknown; error?: string | null } = {}
  ): void {
    this.ctx.db
      .update(workflowNodeRuns)
      .set({ status, endedAt: now(), ...patch })
      .where(eq(workflowNodeRuns.id, nodeRunId))
      .run()
  }

  nodeRuns(runId: string): WorkflowNodeRunRow[] {
    return this.ctx.db
      .select()
      .from(workflowNodeRuns)
      .where(eq(workflowNodeRuns.runId, runId))
      .orderBy(workflowNodeRuns.startedAt)
      .all()
  }
}
