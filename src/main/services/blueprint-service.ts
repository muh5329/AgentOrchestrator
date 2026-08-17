import type { AppContext } from '../core/context'
import { AppError } from '../core/errors'
import type { AgentRow } from '../db/schema'
import {
  AGENT_TEMPLATES,
  BLUEPRINT_VERSION,
  TEMPLATE_BY_ID,
  parseBlueprint,
  type AgentBlueprint,
  type AgentTemplate
} from '../../shared/agent-templates'
import type { Permission } from '../../shared/domain'
import { now } from '../util/time'

/**
 * Agents as portable designs.
 *
 * An agent is a row with a life - parentage, status, a task history - and none
 * of that travels. What travels is the design: what it is for, how it is told to
 * behave, what it may reach. Importing produces a new agent that behaves the
 * same, not a clone that claims someone else's past.
 */
export class BlueprintService {
  constructor(private readonly ctx: AppContext) {}

  templates(): AgentTemplate[] {
    return AGENT_TEMPLATES
  }

  /** Reads an agent out as a blueprint, including the toolkits it holds. */
  export(agentId: string): AgentBlueprint {
    const agent = this.ctx.agents.get(agentId)
    const toolkitIds = this.ctx.agents.toolkitIds(agentId)
    const toolkits = this.ctx.tools
      .listToolkits(agent.projectId)
      .filter((kit) => toolkitIds.includes(kit.id))
      .map((kit) => kit.name)

    return {
      kind: 'agent-orchestrator/agent',
      version: BLUEPRINT_VERSION,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      provider: agent.provider,
      model: agent.model,
      temperature: agent.temperature,
      toolkits,
      permissions: agent.permissions,
      maxChildren: agent.maxChildren,
      maxDepth: agent.maxDepth,
      exportedAt: now()
    }
  }

  /**
   * Creates an agent from pasted JSON.
   *
   * `createdByAgentId` is threaded through so the ordinary rule still applies
   * when an agent imports a blueprint: it cannot hand out authority it does not
   * hold. A human importing from the interface has no such ceiling, which is the
   * point of being the human.
   */
  import(input: {
    projectId: string
    json: string
    createdByAgentId?: string | null
    parentAgentId?: string | null
    nameOverride?: string
  }): AgentRow {
    const parsed = parseBlueprint(input.json)
    if (!parsed.ok) throw new AppError(parsed.error, 'INVALID')
    const blueprint = parsed.blueprint

    let permissions = blueprint.permissions
    if (input.createdByAgentId) {
      const creator = this.ctx.agents.get(input.createdByAgentId)
      permissions = permissions.filter((p) => creator.permissions.includes(p as Permission))
    }

    return this.ctx.agents.create({
      projectId: input.projectId,
      name: this.uniqueName(input.projectId, input.nameOverride || blueprint.name),
      role: blueprint.role,
      description: blueprint.description,
      systemPrompt: blueprint.systemPrompt,
      provider: blueprint.provider,
      model: blueprint.model,
      temperature: blueprint.temperature,
      permissions,
      toolkitNames: blueprint.toolkits,
      maxChildren: blueprint.maxChildren ?? null,
      maxDepth: blueprint.maxDepth ?? null,
      parentAgentId: input.parentAgentId ?? null,
      createdByAgentId: input.createdByAgentId ?? null
    })
  }

  /** Creates an agent from one of the catalogue templates. */
  fromTemplate(input: {
    projectId: string
    templateId: string
    name?: string
    parentAgentId?: string | null
    createdByAgentId?: string | null
  }): AgentRow {
    const template = TEMPLATE_BY_ID.get(input.templateId)
    if (!template) throw new AppError(`No agent template called "${input.templateId}".`, 'INVALID')

    if (template.singleton) {
      const existing = this.ctx.agents
        .list(input.projectId)
        .find((agent) => agent.role === template.role)
      if (existing) {
        throw new AppError(
          `This project already has a ${template.name} ("${existing.name}"). ` +
            'Only one may exist per project.',
          'INVALID'
        )
      }
    }

    let permissions = template.permissions
    if (input.createdByAgentId) {
      const creator = this.ctx.agents.get(input.createdByAgentId)
      permissions = permissions.filter((p) => creator.permissions.includes(p))
    }

    return this.ctx.agents.create({
      projectId: input.projectId,
      name: this.uniqueName(input.projectId, input.name || template.name),
      role: template.role,
      description: template.description,
      systemPrompt: template.systemPrompt,
      permissions,
      toolkitNames: template.toolkits,
      parentAgentId: input.parentAgentId ?? null,
      createdByAgentId: input.createdByAgentId ?? null
    })
  }

  /** "Planner", "Planner 2", "Planner 3" - names are how people refer to agents. */
  private uniqueName(projectId: string, wanted: string): string {
    const taken = new Set(this.ctx.agents.list(projectId).map((a) => a.name))
    if (!taken.has(wanted)) return wanted
    for (let i = 2; i < 500; i++) {
      const candidate = `${wanted} ${i}`
      if (!taken.has(candidate)) return candidate
    }
    return `${wanted} ${Date.now()}`
  }
}
