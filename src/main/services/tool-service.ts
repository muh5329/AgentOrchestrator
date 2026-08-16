import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { AppError, NotFoundError } from '../core/errors'
import {
  agentToolkits,
  tools as toolsTable,
  toolkits as toolkitsTable,
  type ToolRow,
  type ToolkitRow
} from '../db/schema'
import type { Permission, ToolKind } from '../../shared/domain'
import { BUILTIN_TOOLKITS, CORE_TOOL_NAMES, findBuiltinTool } from '../runtime/tools'
import { id } from '../util/id'
import { now } from '../util/time'

export interface CreateCustomToolInput {
  projectId: string
  toolkitName: string
  name: string
  description: string
  kind: Exclude<ToolKind, 'builtin' | 'mcp' | 'agent'>
  implementation: string
  parameters?: string[]
  requiredPermissions?: Permission[]
  timeoutMs?: number
  createdByAgentId?: string | null
}

export class ToolService {
  constructor(private readonly ctx: AppContext) {}

  /**
   * Mirrors the code-defined built-in toolkits into the database so the UI can
   * list them, agents can be assigned them, and custom tools can live alongside.
   * Idempotent: safe to run on every boot.
   */
  seedBuiltins(): void {
    for (const kit of BUILTIN_TOOLKITS) {
      let row = this.ctx.db
        .select()
        .from(toolkitsTable)
        .where(and(eq(toolkitsTable.name, kit.name), isNull(toolkitsTable.projectId)))
        .get()

      if (!row) {
        const toolkitId = id('kit')
        this.ctx.db
          .insert(toolkitsTable)
          .values({
            id: toolkitId,
            projectId: null,
            name: kit.name,
            description: kit.description,
            isBuiltIn: true,
            createdAt: now(),
            updatedAt: now()
          })
          .run()
        row = this.ctx.db.select().from(toolkitsTable).where(eq(toolkitsTable.id, toolkitId)).get()!
      }

      for (const toolName of kit.tools) {
        const def = findBuiltinTool(toolName)
        if (!def) continue
        const existing = this.ctx.db
          .select()
          .from(toolsTable)
          .where(and(eq(toolsTable.toolkitId, row.id), eq(toolsTable.name, toolName)))
          .get()
        const values = {
          toolkitId: row.id,
          name: def.name,
          description: def.description,
          kind: 'builtin' as ToolKind,
          inputSchema: def.inputSchema,
          requiredPermissions: def.requiredPermissions,
          timeoutMs: def.timeoutMs ?? 60_000,
          isBuiltIn: true,
          updatedAt: now()
        }
        if (existing) {
          this.ctx.db.update(toolsTable).set(values).where(eq(toolsTable.id, existing.id)).run()
        } else {
          this.ctx.db
            .insert(toolsTable)
            .values({ id: id('tol'), createdAt: now(), ...values })
            .run()
        }
      }
    }
  }

  listToolkits(projectId?: string): ToolkitRow[] {
    return this.ctx.db
      .select()
      .from(toolkitsTable)
      .where(
        projectId
          ? or(isNull(toolkitsTable.projectId), eq(toolkitsTable.projectId, projectId))
          : undefined
      )
      .all()
  }

  toolkitByName(name: string, projectId?: string): ToolkitRow | undefined {
    return this.ctx.db
      .select()
      .from(toolkitsTable)
      .where(
        and(
          eq(toolkitsTable.name, name),
          projectId
            ? or(isNull(toolkitsTable.projectId), eq(toolkitsTable.projectId, projectId))
            : isNull(toolkitsTable.projectId)
        )
      )
      .get()
  }

  listTools(toolkitId: string): ToolRow[] {
    return this.ctx.db.select().from(toolsTable).where(eq(toolsTable.toolkitId, toolkitId)).all()
  }

  getTool(toolId: string): ToolRow {
    const row = this.ctx.db.select().from(toolsTable).where(eq(toolsTable.id, toolId)).get()
    if (!row) throw new NotFoundError('Tool', toolId)
    return row
  }

  /** Every tool row an agent may call, de-duplicated by name. */
  toolsForAgent(agentId: string): ToolRow[] {
    const kitIds = this.ctx.db
      .select({ toolkitId: agentToolkits.toolkitId })
      .from(agentToolkits)
      .where(eq(agentToolkits.agentId, agentId))
      .all()
      .map((r) => r.toolkitId)

    const coreKit = this.toolkitByName('Core')
    if (coreKit) kitIds.push(coreKit.id)

    if (!kitIds.length) return []

    const rows = this.ctx.db
      .select()
      .from(toolsTable)
      .where(and(inArray(toolsTable.toolkitId, kitIds), eq(toolsTable.enabled, true)))
      .all()

    const seen = new Set<string>()
    const out: ToolRow[] = []
    for (const row of rows) {
      if (seen.has(row.name)) continue
      seen.add(row.name)
      out.push(row)
    }
    return out
  }

  /**
   * The same list, annotated with the two things the interface needs and a row
   * on its own cannot say: whether calling it will stop for a human, and whether
   * this agent can reach it at all.
   *
   * `dangerous` lives on the built-in definition rather than in the table, and
   * holding a toolkit is not the same as holding the permissions its tools
   * require - an agent can own a toolkit whose tools it may never call.
   */
  toolsForAgentDetailed(agentId: string): Array<ToolRow & { dangerous: boolean; reachable: boolean }> {
    const agent = this.ctx.agents.get(agentId)
    const settings = this.ctx.projects.settings(agent.projectId)

    return this.toolsForAgent(agentId).map((tool) => ({
      ...tool,
      dangerous:
        (findBuiltinTool(tool.name)?.dangerous ?? false) ||
        tool.requiredPermissions.some((p) => settings.requireApprovalFor.includes(p)),
      reachable: tool.requiredPermissions.every((p) => agent.permissions.includes(p))
    }))
  }

  /** Name lookup across the agent's granted tools, used at call time. */
  findToolForAgent(agentId: string, name: string): ToolRow | undefined {
    if (CORE_TOOL_NAMES.includes(name)) {
      const core = this.toolkitByName('Core')
      if (core) {
        const row = this.ctx.db
          .select()
          .from(toolsTable)
          .where(and(eq(toolsTable.toolkitId, core.id), eq(toolsTable.name, name)))
          .get()
        if (row) return row
      }
    }
    return this.toolsForAgent(agentId).find((t) => t.name === name)
  }

  createCustomTool(input: CreateCustomToolInput): ToolRow {
    if (!/^[a-z][a-z0-9_]*$/.test(input.name)) {
      throw new AppError(
        `Tool name "${input.name}" must be snake_case: lowercase letters, digits and underscores.`,
        'INVALID'
      )
    }
    if (findBuiltinTool(input.name)) {
      throw new AppError(`"${input.name}" is a built-in tool name.`, 'INVALID')
    }

    let kit = this.toolkitByName(input.toolkitName, input.projectId)
    if (!kit || kit.isBuiltIn) {
      const toolkitId = id('kit')
      this.ctx.db
        .insert(toolkitsTable)
        .values({
          id: toolkitId,
          projectId: input.projectId,
          name: kit?.isBuiltIn ? `${input.toolkitName} (project)` : input.toolkitName,
          description: 'Custom tools created for this project.',
          isBuiltIn: false,
          createdAt: now(),
          updatedAt: now()
        })
        .run()
      kit = this.ctx.db.select().from(toolkitsTable).where(eq(toolkitsTable.id, toolkitId)).get()!
    }

    const properties: Record<string, unknown> = {}
    for (const param of input.parameters ?? []) {
      properties[param] = { type: 'string', description: `Value for {{${param}}}.` }
    }

    const defaultPermissions: Permission[] =
      input.kind === 'shell'
        ? ['SHELL_EXECUTE']
        : input.kind === 'http'
          ? ['NETWORK_ACCESS']
          : []

    const toolId = id('tol')
    this.ctx.db
      .insert(toolsTable)
      .values({
        id: toolId,
        toolkitId: kit.id,
        name: input.name,
        description: input.description,
        kind: input.kind,
        inputSchema: {
          type: 'object',
          properties,
          required: input.parameters ?? [],
          additionalProperties: false
        },
        implementation: input.implementation,
        requiredPermissions: input.requiredPermissions ?? defaultPermissions,
        timeoutMs: input.timeoutMs ?? 120_000,
        isBuiltIn: false,
        createdAt: now(),
        updatedAt: now()
      })
      .run()

    this.ctx.bus.emit({
      type: 'SYSTEM',
      projectId: input.projectId,
      agentId: input.createdByAgentId ?? null,
      message: `Tool "${input.name}" created in toolkit "${kit.name}"`,
      data: { toolId, kind: input.kind }
    })

    return this.getTool(toolId)
  }

  updateTool(toolId: string, patch: Partial<ToolRow>): ToolRow {
    const row = this.getTool(toolId)
    if (row.isBuiltIn && patch.implementation) {
      throw new AppError('Built-in tools cannot have their implementation replaced.', 'INVALID')
    }
    this.ctx.db
      .update(toolsTable)
      .set({ ...patch, updatedAt: now() })
      .where(eq(toolsTable.id, toolId))
      .run()
    return this.getTool(toolId)
  }

  deleteTool(toolId: string): void {
    const row = this.getTool(toolId)
    if (row.isBuiltIn) throw new AppError('Built-in tools cannot be deleted.', 'INVALID')
    this.ctx.db.delete(toolsTable).where(eq(toolsTable.id, toolId)).run()
  }

  createToolkit(projectId: string | null, name: string, description = ''): ToolkitRow {
    const toolkitId = id('kit')
    this.ctx.db
      .insert(toolkitsTable)
      .values({
        id: toolkitId,
        projectId,
        name,
        description,
        isBuiltIn: false,
        createdAt: now(),
        updatedAt: now()
      })
      .run()
    return this.ctx.db.select().from(toolkitsTable).where(eq(toolkitsTable.id, toolkitId)).get()!
  }
}
