import { and, asc, count, eq, inArray, isNull, or } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { LimitError, NotFoundError } from '../core/errors'
import {
  agentRelationships,
  agentToolkits,
  agents as agentsTable,
  toolkits as toolkitsTable,
  type AgentRelationshipRow,
  type AgentRow
} from '../db/schema'
import {
  DEFAULT_AGENT_PERMISSIONS,
  type AgentRelationKind,
  type AgentRole,
  type AgentStatus,
  type Permission
} from '../../shared/domain'
import { id } from '../util/id'
import { now } from '../util/time'

export interface CreateAgentInput {
  projectId: string
  name: string
  role?: AgentRole
  description?: string
  systemPrompt?: string
  provider?: string
  model?: string
  temperature?: number
  permissions?: Permission[]
  parentAgentId?: string | null
  createdByAgentId?: string | null
  toolkitIds?: string[]
  toolkitNames?: string[]
  maxChildren?: number | null
  maxDepth?: number | null
  isBuiltIn?: boolean
  config?: Record<string, unknown>
}

export interface AgentGraph {
  nodes: Array<
    AgentRow & {
      childCount: number
      openTasks: number
      runningTasks: number
      lastScore: number | null
    }
  >
  edges: AgentRelationshipRow[]
}

export class AgentService {
  constructor(private readonly ctx: AppContext) {}

  create(input: CreateAgentInput): AgentRow {
    const project = this.ctx.projects.get(input.projectId)
    const limits = project.settings.limits

    let depth = 0
    if (input.parentAgentId) {
      const parent = this.get(input.parentAgentId)
      depth = parent.depth + 1

      const maxDepth = parent.maxDepth ?? limits.maxDepth
      if (depth > maxDepth) {
        throw new LimitError(
          `Cannot create agent: depth ${depth} exceeds the limit of ${maxDepth}.`,
          { limit: 'maxDepth', depth, maxDepth, parentAgentId: parent.id }
        )
      }

      const siblings = this.countChildren(parent.id)
      const maxChildren = parent.maxChildren ?? limits.maxChildrenPerAgent
      if (siblings >= maxChildren) {
        throw new LimitError(
          `Cannot create agent: "${parent.name}" already has ${siblings} children (limit ${maxChildren}).`,
          { limit: 'maxChildrenPerAgent', siblings, maxChildren, parentAgentId: parent.id }
        )
      }
    }

    const total = this.countInProject(input.projectId)
    if (total >= limits.maxTotalAgents) {
      throw new LimitError(
        `Cannot create agent: project already has ${total} agents (limit ${limits.maxTotalAgents}).`,
        { limit: 'maxTotalAgents', total, maxTotalAgents: limits.maxTotalAgents }
      )
    }

    const name = this.uniqueName(input.projectId, input.name)
    const agentId = id('agt')
    const ts = now()

    this.ctx.db
      .insert(agentsTable)
      .values({
        id: agentId,
        projectId: input.projectId,
        parentAgentId: input.parentAgentId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        name,
        role: input.role ?? 'worker',
        description: input.description ?? '',
        systemPrompt: input.systemPrompt ?? '',
        provider: input.provider ?? project.settings.defaultProvider,
        model: input.model ?? project.settings.defaultModel,
        temperature: Math.round((input.temperature ?? 0.7) * 100),
        status: 'CREATED',
        permissions: input.permissions ?? DEFAULT_AGENT_PERMISSIONS,
        depth,
        maxChildren: input.maxChildren ?? null,
        maxDepth: input.maxDepth ?? null,
        isBuiltIn: input.isBuiltIn ?? false,
        config: input.config ?? {},
        createdAt: ts,
        updatedAt: ts
      })
      .run()

    const toolkitIds = new Set(input.toolkitIds ?? [])
    for (const name of input.toolkitNames ?? []) {
      const kit = this.ctx.db
        .select()
        .from(toolkitsTable)
        .where(
          and(
            eq(toolkitsTable.name, name),
            or(isNull(toolkitsTable.projectId), eq(toolkitsTable.projectId, input.projectId))
          )
        )
        .get()
      if (kit) toolkitIds.add(kit.id)
    }
    for (const toolkitId of toolkitIds) {
      this.ctx.db.insert(agentToolkits).values({ agentId, toolkitId }).run()
    }

    if (input.parentAgentId) {
      this.link(input.projectId, input.parentAgentId, agentId, 'PARENT_OF')
      this.link(input.projectId, agentId, input.parentAgentId, 'REPORTS_TO')
    }

    const row = this.get(agentId)
    this.ctx.bus.emit({
      type: input.parentAgentId ? 'AGENT_SPAWNED' : 'AGENT_CREATED',
      projectId: input.projectId,
      agentId,
      message: input.parentAgentId
        ? `${this.get(input.parentAgentId).name} spawned "${name}"`
        : `Agent "${name}" created`,
      data: { name, role: row.role, depth, parentAgentId: input.parentAgentId ?? null }
    })
    return row
  }

  private uniqueName(projectId: string, desired: string): string {
    const base = desired.trim() || 'Agent'
    let candidate = base
    let n = 2
    while (
      this.ctx.db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(and(eq(agentsTable.projectId, projectId), eq(agentsTable.name, candidate)))
        .get()
    ) {
      candidate = `${base} ${n++}`
    }
    return candidate
  }

  get(agentId: string): AgentRow {
    const row = this.ctx.db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).get()
    if (!row) throw new NotFoundError('Agent', agentId)
    return row
  }

  find(agentId: string): AgentRow | undefined {
    return this.ctx.db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).get()
  }

  findByName(projectId: string, name: string): AgentRow | undefined {
    return this.ctx.db
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.projectId, projectId), eq(agentsTable.name, name)))
      .get()
  }

  /** Accepts either an id or a name, which is what agents naturally produce. */
  resolve(projectId: string, idOrName: string): AgentRow {
    const byId = this.find(idOrName)
    if (byId) return byId
    const byName = this.findByName(projectId, idOrName)
    if (byName) return byName
    throw new NotFoundError('Agent', idOrName)
  }

  list(projectId: string): AgentRow[] {
    return this.ctx.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.projectId, projectId))
      .orderBy(asc(agentsTable.depth), asc(agentsTable.createdAt))
      .all()
  }

  children(agentId: string): AgentRow[] {
    return this.ctx.db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.parentAgentId, agentId))
      .all()
  }

  countChildren(agentId: string): number {
    return (
      this.ctx.db
        .select({ n: count() })
        .from(agentsTable)
        .where(eq(agentsTable.parentAgentId, agentId))
        .get()?.n ?? 0
    )
  }

  countInProject(projectId: string): number {
    return (
      this.ctx.db
        .select({ n: count() })
        .from(agentsTable)
        .where(eq(agentsTable.projectId, projectId))
        .get()?.n ?? 0
    )
  }

  ancestors(agentId: string): AgentRow[] {
    const chain: AgentRow[] = []
    let current = this.find(agentId)
    const seen = new Set<string>()
    while (current?.parentAgentId && !seen.has(current.parentAgentId)) {
      seen.add(current.parentAgentId)
      const parent = this.find(current.parentAgentId)
      if (!parent) break
      chain.push(parent)
      current = parent
    }
    return chain
  }

  /** All descendants, breadth first. */
  descendants(agentId: string): AgentRow[] {
    const out: AgentRow[] = []
    const queue = [agentId]
    const seen = new Set<string>([agentId])
    while (queue.length) {
      const next = queue.shift() as string
      for (const child of this.children(next)) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        out.push(child)
        queue.push(child.id)
      }
    }
    return out
  }

  update(
    agentId: string,
    patch: Partial<
      Pick<
        AgentRow,
        | 'name'
        | 'description'
        | 'systemPrompt'
        | 'provider'
        | 'model'
        | 'temperature'
        | 'permissions'
        | 'maxChildren'
        | 'maxDepth'
        | 'config'
        | 'role'
      >
    >
  ): AgentRow {
    this.get(agentId)
    this.ctx.db
      .update(agentsTable)
      .set({ ...patch, updatedAt: now() })
      .where(eq(agentsTable.id, agentId))
      .run()
    const row = this.get(agentId)
    this.ctx.bus.emit({
      type: 'AGENT_UPDATED',
      projectId: row.projectId,
      agentId,
      message: `Agent "${row.name}" updated`,
      data: { fields: Object.keys(patch) }
    })
    return row
  }

  setStatus(agentId: string, status: AgentStatus, message?: string): AgentRow {
    const before = this.get(agentId)
    if (before.status === status) return before
    this.ctx.db
      .update(agentsTable)
      .set({ status, updatedAt: now(), lastActiveAt: now() })
      .where(eq(agentsTable.id, agentId))
      .run()
    const row = this.get(agentId)
    const type =
      status === 'RUNNING'
        ? 'AGENT_STARTED'
        : status === 'FAILED'
          ? 'AGENT_FAILED'
          : status === 'COMPLETED'
            ? 'AGENT_COMPLETED'
            : status === 'IDLE' && before.status === 'RUNNING'
              ? 'AGENT_STOPPED'
              : 'AGENT_UPDATED'
    this.ctx.bus.emit({
      type,
      projectId: row.projectId,
      agentId,
      level: status === 'FAILED' ? 'error' : 'info',
      message: message ?? `Agent "${row.name}" is ${status.toLowerCase()}`,
      data: { from: before.status, to: status }
    })
    return row
  }

  clone(agentId: string, overrides: Partial<CreateAgentInput> = {}): AgentRow {
    const source = this.get(agentId)
    const kits = this.ctx.db
      .select({ toolkitId: agentToolkits.toolkitId })
      .from(agentToolkits)
      .where(eq(agentToolkits.agentId, agentId))
      .all()
    return this.create({
      projectId: source.projectId,
      name: overrides.name ?? `${source.name} (copy)`,
      role: source.role,
      description: source.description,
      systemPrompt: source.systemPrompt,
      provider: source.provider,
      model: source.model,
      temperature: source.temperature / 100,
      permissions: source.permissions,
      parentAgentId: source.parentAgentId,
      toolkitIds: kits.map((k) => k.toolkitId),
      maxChildren: source.maxChildren,
      maxDepth: source.maxDepth,
      config: source.config,
      ...overrides
    })
  }

  /** Deletes an agent and, unless told otherwise, its whole subtree. */
  delete(agentId: string, cascade = true): string[] {
    const agent = this.get(agentId)
    const targets = cascade ? [agent, ...this.descendants(agentId)] : [agent]
    const ids = targets.map((a) => a.id)
    this.ctx.db.delete(agentsTable).where(inArray(agentsTable.id, ids)).run()
    this.ctx.db
      .delete(agentRelationships)
      .where(
        or(
          inArray(agentRelationships.fromAgentId, ids),
          inArray(agentRelationships.toAgentId, ids)
        )
      )
      .run()
    this.ctx.bus.emit({
      type: 'AGENT_DELETED',
      projectId: agent.projectId,
      message: `Agent "${agent.name}" deleted${ids.length > 1 ? ` with ${ids.length - 1} descendants` : ''}`,
      data: { agentIds: ids }
    })
    return ids
  }

  link(
    projectId: string,
    fromAgentId: string,
    toAgentId: string,
    kind: AgentRelationKind,
    metadata: Record<string, unknown> = {}
  ): void {
    const existing = this.ctx.db
      .select()
      .from(agentRelationships)
      .where(
        and(
          eq(agentRelationships.fromAgentId, fromAgentId),
          eq(agentRelationships.toAgentId, toAgentId),
          eq(agentRelationships.kind, kind)
        )
      )
      .get()
    if (existing) return
    this.ctx.db
      .insert(agentRelationships)
      .values({
        id: id('rel'),
        projectId,
        fromAgentId,
        toAgentId,
        kind,
        metadata,
        createdAt: now()
      })
      .run()
  }

  unlink(fromAgentId: string, toAgentId: string, kind: AgentRelationKind): void {
    this.ctx.db
      .delete(agentRelationships)
      .where(
        and(
          eq(agentRelationships.fromAgentId, fromAgentId),
          eq(agentRelationships.toAgentId, toAgentId),
          eq(agentRelationships.kind, kind)
        )
      )
      .run()
  }

  relationships(projectId: string): AgentRelationshipRow[] {
    return this.ctx.db
      .select()
      .from(agentRelationships)
      .where(eq(agentRelationships.projectId, projectId))
      .all()
  }

  graph(projectId: string): AgentGraph {
    const nodes = this.list(projectId).map((agent) => {
      const tasks = this.ctx.tasks.listByAgent(agent.id)
      const lastScored = tasks.filter((t) => t.score != null).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      return {
        ...agent,
        childCount: this.countChildren(agent.id),
        openTasks: tasks.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status)).length,
        runningTasks: tasks.filter((t) => t.status === 'RUNNING').length,
        lastScore: lastScored?.score == null ? null : lastScored.score / 100
      }
    })
    return { nodes, edges: this.relationships(projectId) }
  }

  toolkitIds(agentId: string): string[] {
    return this.ctx.db
      .select({ toolkitId: agentToolkits.toolkitId })
      .from(agentToolkits)
      .where(eq(agentToolkits.agentId, agentId))
      .all()
      .map((r) => r.toolkitId)
  }

  setToolkits(agentId: string, toolkitIds: string[]): void {
    this.ctx.db.delete(agentToolkits).where(eq(agentToolkits.agentId, agentId)).run()
    for (const toolkitId of toolkitIds) {
      this.ctx.db.insert(agentToolkits).values({ agentId, toolkitId }).run()
    }
    const row = this.get(agentId)
    this.ctx.bus.emit({
      type: 'AGENT_UPDATED',
      projectId: row.projectId,
      agentId,
      message: `Toolkits updated for "${row.name}"`,
      data: { toolkitIds }
    })
  }

  hasPermission(agentId: string, permission: Permission): boolean {
    return this.get(agentId).permissions.includes(permission)
  }

  grant(agentId: string, permissions: Permission[]): AgentRow {
    const agent = this.get(agentId)
    const merged = Array.from(new Set([...agent.permissions, ...permissions]))
    return this.update(agentId, { permissions: merged })
  }

  revoke(agentId: string, permissions: Permission[]): AgentRow {
    const agent = this.get(agentId)
    const merged = agent.permissions.filter((p) => !permissions.includes(p))
    return this.update(agentId, { permissions: merged })
  }

  orchestratorFor(projectId: string): AgentRow | undefined {
    return this.ctx.db
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.projectId, projectId), eq(agentsTable.role, 'orchestrator')))
      .get()
  }

  judgeFor(projectId: string): AgentRow | undefined {
    return this.ctx.db
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.projectId, projectId), eq(agentsTable.role, 'judge')))
      .get()
  }
}
