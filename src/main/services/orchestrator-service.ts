import type { AppContext } from '../core/context'
import { AppError } from '../core/errors'
import type { ProjectRow, TaskRow } from '../db/schema'
import type { AcceptanceCriterion, Permission } from '../../shared/domain'
import type { PartialProjectSettings } from './project-service'

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  /** Extra guidance appended to the project's instructions. */
  instructions: string
  /** Toolkits and permissions the Orchestrator starts with. */
  orchestratorToolkits: string[]
  orchestratorPermissions: Permission[]
  suggestedCriteria: string[]
}

/**
 * Templates bootstrap, they do not prescribe.
 *
 * Each one gives the Orchestrator a different starting posture - which tools it
 * holds, what "done" tends to mean in this kind of work - and then gets out of
 * the way. The fleet itself is always decided by the Orchestrator at runtime.
 */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'software',
    name: 'Software project',
    description: 'Build or extend a codebase, with tests and review.',
    instructions:
      'This is a software project. Work happens in the project workspace. Nothing counts as ' +
      'done without tests that actually run. Prefer small, reviewable tasks over one large one.',
    // The Orchestrator holds the superset its fleet may need: an agent can only
    // grant permissions it holds itself, so a staffing agent that cannot write
    // files cannot staff a writer.
    orchestratorToolkits: ['Orchestration', 'Knowledge', 'Inspection'],
    orchestratorPermissions: [
      'FILES_READ',
      'FILES_WRITE',
      'SHELL_EXECUTE',
      'AGENT_CREATE',
      'AGENT_INVOKE',
      'AGENT_MESSAGE',
      'TASK_CREATE',
      'TASK_UPDATE',
      'SCHEDULE_CREATE',
      'TOOL_CREATE',
      'MEMORY_WRITE',
      'JUDGE_INVOKE'
    ],
    suggestedCriteria: [
      'The feature works end to end',
      'Automated tests exist and pass',
      'No secrets or credentials are committed'
    ]
  },
  {
    id: 'research',
    name: 'Research project',
    description: 'Investigate a question and produce a sourced answer.',
    instructions:
      'This is a research project. Every claim needs a source. Distinguish what you verified ' +
      'from what you inferred, and say plainly when the evidence is thin.',
    orchestratorToolkits: ['Orchestration', 'Knowledge', 'Web'],
    orchestratorPermissions: [
      'AGENT_CREATE',
      'AGENT_INVOKE',
      'AGENT_MESSAGE',
      'TASK_CREATE',
      'TASK_UPDATE',
      'MEMORY_WRITE',
      'NETWORK_ACCESS',
      'JUDGE_INVOKE'
    ],
    suggestedCriteria: [
      'The question is answered directly',
      'Every substantive claim has a source',
      'Contradicting evidence is acknowledged'
    ]
  },
  {
    id: 'content',
    name: 'Content project',
    description: 'Plan, draft, edit and publish written work.',
    instructions:
      'This is a content project. Drafts are judged on clarity and accuracy, not length. ' +
      'Separate drafting from editing - use different agents for each.',
    orchestratorToolkits: ['Orchestration', 'Knowledge'],
    orchestratorPermissions: [
      'AGENT_CREATE',
      'AGENT_INVOKE',
      'AGENT_MESSAGE',
      'TASK_CREATE',
      'TASK_UPDATE',
      'MEMORY_WRITE',
      'JUDGE_INVOKE'
    ],
    suggestedCriteria: ['The brief is satisfied', 'Facts are checked', 'The voice is consistent']
  },
  {
    id: 'automation',
    name: 'Business automation',
    description: 'Recurring work on a schedule, with escalation to a human.',
    instructions:
      'This is an automation project. Prefer schedules over one-off tasks. Anything that ' +
      'touches an external system must ask for approval first.',
    orchestratorToolkits: ['Orchestration', 'Knowledge', 'Inspection'],
    orchestratorPermissions: [
      'AGENT_CREATE',
      'AGENT_INVOKE',
      'AGENT_MESSAGE',
      'TASK_CREATE',
      'TASK_UPDATE',
      'SCHEDULE_CREATE',
      'MEMORY_WRITE',
      'JUDGE_INVOKE'
    ],
    suggestedCriteria: [
      'The automation runs on its schedule',
      'Failures escalate rather than fail silently'
    ]
  },
  {
    id: 'blank',
    name: 'Blank project',
    description: 'Just an Orchestrator and a Judge. You decide everything else.',
    instructions: '',
    orchestratorToolkits: ['Orchestration', 'Knowledge'],
    orchestratorPermissions: [
      'AGENT_CREATE',
      'AGENT_INVOKE',
      'AGENT_MESSAGE',
      'TASK_CREATE',
      'TASK_UPDATE',
      'MEMORY_WRITE',
      'JUDGE_INVOKE'
    ],
    suggestedCriteria: []
  }
]

export interface LaunchMissionInput {
  name: string
  mission: string
  description?: string
  instructions?: string
  rootPath?: string | null
  templateId?: string
  settings?: PartialProjectSettings
  acceptanceCriteria?: string[]
  /** Start the Orchestrator immediately. */
  autoStart?: boolean
}

/**
 * The one-prompt path: a mission in, a running fleet out.
 *
 * This service does not plan the work. It creates the project, points the
 * Orchestrator at the mission and lets the Orchestrator decide what agents and
 * tasks the mission actually needs.
 */
export class OrchestratorService {
  constructor(private readonly ctx: AppContext) {}

  templates(): ProjectTemplate[] {
    return PROJECT_TEMPLATES
  }

  createFromMission(input: LaunchMissionInput): { project: ProjectRow; kickoffTask: TaskRow | null } {
    const template =
      PROJECT_TEMPLATES.find((t) => t.id === (input.templateId ?? 'blank')) ??
      PROJECT_TEMPLATES[PROJECT_TEMPLATES.length - 1]

    const criteria: AcceptanceCriterion[] = (
      input.acceptanceCriteria?.length ? input.acceptanceCriteria : template.suggestedCriteria
    ).map((text, i) => ({ id: `PC${i + 1}`, text, met: null }))

    const project = this.ctx.projects.create({
      name: input.name,
      description: input.description ?? '',
      mission: input.mission,
      instructions: [input.instructions ?? '', template.instructions].filter(Boolean).join('\n\n'),
      rootPath: input.rootPath ?? null,
      template: template.id,
      settings: input.settings,
      acceptanceCriteria: criteria
    })

    const orchestrator = this.ctx.agents.orchestratorFor(project.id)
    if (orchestrator) {
      this.ctx.agents.update(orchestrator.id, { permissions: template.orchestratorPermissions })
      const toolkitIds = template.orchestratorToolkits
        .map((name) => this.ctx.tools.toolkitByName(name, project.id)?.id)
        .filter((toolkitId): toolkitId is string => Boolean(toolkitId))
      if (toolkitIds.length) this.ctx.agents.setToolkits(orchestrator.id, toolkitIds)
    }

    const kickoffTask = input.autoStart === false ? null : this.launch(project.id)
    return { project: this.ctx.projects.get(project.id), kickoffTask }
  }

  /** Creates and queues the Orchestrator's planning task. */
  launch(projectId: string): TaskRow {
    const project = this.ctx.projects.get(projectId)
    const orchestrator = this.ctx.agents.orchestratorFor(projectId)
    if (!orchestrator) {
      throw new AppError('This project has no Orchestrator agent.', 'NO_ORCHESTRATOR')
    }

    const existing = this.ctx.tasks
      .listByAgent(orchestrator.id)
      .find((t) => t.context.kickoff === true && !['COMPLETED', 'CANCELLED', 'FAILED'].includes(t.status))
    if (existing) return existing

    const criteria = project.acceptanceCriteria.map((c) => c.text)
    const task = this.ctx.tasks.create({
      projectId,
      agentId: orchestrator.id,
      title: `Plan and run: ${project.name}`,
      description:
        `Mission:\n${project.mission}\n\n` +
        `Work out what this mission actually requires, then build the fleet to do it.\n` +
        `Start by calling project_status and list_agents so you know what already exists.\n` +
        `Create only the specialists the mission needs, give each one a sharp system prompt, ` +
        `and break the work into tasks with checkable acceptance criteria. Use delegate_task ` +
        `for work that can run in parallel and invoke_agent when you need an answer before ` +
        `you can plan further. When everything is delegated and dependencies are wired, ` +
        `call complete_task with your plan as the summary.`,
      acceptanceCriteria: [
        'A fleet of agents appropriate to the mission exists',
        'Every agent has a specific system prompt and minimal permissions',
        'The mission is broken into tasks with acceptance criteria',
        'Dependencies between tasks are declared',
        ...criteria.map((c) => `Project criterion is addressed by at least one task: ${c}`)
      ],
      priority: 90,
      requiresJudge: true,
      status: 'READY',
      context: { kickoff: true }
    })

    this.ctx.projects.setStatus(projectId, 'ACTIVE')
    this.ctx.executor.enqueue(task.id)

    this.ctx.bus.emit({
      type: 'SYSTEM',
      projectId,
      agentId: orchestrator.id,
      taskId: task.id,
      message: `Orchestrator launched for "${project.name}"`,
      data: { taskId: task.id }
    })

    return task
  }

  /** Pauses a project: stops dispatching and cancels in-flight work. */
  pause(projectId: string): void {
    this.ctx.projects.setStatus(projectId, 'PAUSED')
    for (const task of this.ctx.tasks.listByStatus(projectId, ['RUNNING', 'QUEUED'])) {
      this.ctx.executor.cancel(task.id)
    }
  }

  resume(projectId: string): void {
    this.ctx.projects.setStatus(projectId, 'ACTIVE')
    for (const task of this.ctx.tasks.listByStatus(projectId, ['BACKLOG', 'BLOCKED'])) {
      this.ctx.tasks.refreshReadiness(task.id)
    }
  }
}
