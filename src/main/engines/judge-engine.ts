import { promises as fs } from 'node:fs'
import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { events as eventsTable, executions as executionsTable } from '../db/schema'
import {
  DEFAULT_RUBRIC_DIMENSIONS,
  type AcceptanceCriterion,
  type CriterionScore,
  type JudgeDecision,
  type JudgeVerdict,
  type RubricDimension
} from '../../shared/domain'
import { JUDGE_SYSTEM_PROMPT } from '../runtime/prompts'

export interface EvaluateOptions {
  executionId?: string
  /** When false the verdict is returned without changing task state. */
  apply?: boolean
  signal?: AbortSignal
  /** Extra judge agents whose verdicts are aggregated with the primary one. */
  panel?: string[]
}

/**
 * Independent verification.
 *
 * The Judge is an ordinary agent running through the ordinary runtime - it has
 * a system prompt, a model and read-only tools. What makes it the Judge is that
 * its verdict, not the worker's claim, decides whether a task is finished.
 */
export class JudgeEngine {
  constructor(private readonly ctx: AppContext) {}

  async evaluate(taskId: string, options: EvaluateOptions = {}): Promise<JudgeVerdict> {
    const task = this.ctx.tasks.get(taskId)
    const project = this.ctx.projects.get(task.projectId)
    const rubric = this.ctx.evaluations.defaultRubric(project.id)

    const primary =
      (task.judgeAgentId ? this.ctx.agents.find(task.judgeAgentId) : undefined) ??
      this.ctx.agents.judgeFor(project.id)

    if (!primary) {
      const verdict = escalation('This project has no Judge agent, so the work cannot be verified.')
      if (options.apply !== false) this.apply(taskId, verdict, options.executionId ?? null, null)
      return verdict
    }

    this.ctx.bus.emit({
      type: 'JUDGE_STARTED',
      projectId: project.id,
      agentId: primary.id,
      taskId,
      executionId: options.executionId ?? null,
      message: `Judge evaluating "${task.title}"`,
      data: { rubric: rubric.name }
    })

    const evidence = await this.gatherEvidence(taskId, options.executionId ?? null)
    const judgeIds = [primary.id, ...(options.panel ?? [])]
    const verdicts: JudgeVerdict[] = []

    for (const judgeId of judgeIds) {
      const judge = this.ctx.agents.find(judgeId)
      if (!judge) continue
      const verdict = await this.runJudge(judge.id, taskId, evidence, rubric.dimensions, options.signal)
      verdicts.push(verdict)
    }

    const merged = aggregateVerdicts(verdicts)
    const finalVerdict: JudgeVerdict = {
      ...merged,
      decision: decide(merged.score, {
        pass: rubric.passThreshold / 100,
        escalate: rubric.escalateThreshold / 100,
        judgeSaid: merged.decision
      })
    }

    if (options.apply !== false) {
      this.apply(taskId, finalVerdict, options.executionId ?? null, primary.id)
    }
    return finalVerdict
  }

  /**
   * Judges the project as a whole against its own acceptance criteria.
   *
   * Individual tasks passing does not mean the mission was accomplished, so
   * when the board empties the Judge reads what was actually produced and
   * decides. A rejection turns into a gap-closing task for the Orchestrator
   * rather than a silent "complete".
   */
  async evaluateProject(
    projectId: string,
    options: { apply?: boolean; signal?: AbortSignal } = {}
  ): Promise<JudgeVerdict> {
    const project = this.ctx.projects.get(projectId)
    const judge = this.ctx.agents.judgeFor(projectId)
    const criteria = project.acceptanceCriteria ?? []

    if (!criteria.length) {
      // Nothing to verify against: the task-level verdicts are all there is.
      const verdict: JudgeVerdict = {
        score: 1,
        decision: 'APPROVED',
        criteria: [],
        issues: [],
        requiredChanges: [],
        summary: 'No project acceptance criteria were set; every task was approved.',
        criteriaChecklist: []
      }
      if (options.apply !== false) this.applyProjectVerdict(projectId, verdict)
      return verdict
    }

    if (!judge) {
      const verdict = escalation('This project has no Judge agent, so it cannot be signed off.')
      if (options.apply !== false) this.applyProjectVerdict(projectId, verdict)
      return verdict
    }

    const tasks = this.ctx.tasks.list(projectId)
    const artifacts = this.ctx.artifacts.listByProject(projectId, 60)

    const prompt = [
      `# Project under review\n${project.name}\n\nMission: ${project.mission}`,
      `\n# Project acceptance criteria\n${criteria.map((c) => `- [${c.id}] ${c.text}`).join('\n')}`,
      `\n# Work completed\n${tasks
        .filter((t) => t.status === 'COMPLETED')
        .map(
          (t) =>
            `- ${t.title} (${t.score == null ? 'unscored' : `${t.score}%`}): ${
              (t.result?.summary as string) ?? ''
            }`
        )
        .join('\n')}`,
      tasks.some((t) => t.status === 'FAILED')
        ? `\n# Work that failed\n${tasks
            .filter((t) => t.status === 'FAILED')
            .map((t) => `- ${t.title}: ${t.error ?? 'no reason recorded'}`)
            .join('\n')}`
        : '',
      `\n# Artifacts produced\n${
        artifacts.length
          ? artifacts.map((a) => `- ${a.kind}: ${a.title}${a.path ? ` (${a.path})` : ''}`).join('\n')
          : 'None.'
      }`,
      `\nDecide, criterion by criterion, whether the mission has actually been accomplished. ` +
        `Put one entry per project criterion in "checklist" using its id. Return only the JSON verdict.`
    ]
      .filter(Boolean)
      .join('\n')

    const controller = new AbortController()
    if (options.signal) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    this.ctx.bus.emit({
      type: 'JUDGE_STARTED',
      projectId,
      agentId: judge.id,
      message: `Judge reviewing the project against its ${criteria.length} acceptance criteria`,
      data: { scope: 'project' }
    })

    // A project review needs a task row to hang the execution off; the most
    // recently completed task is the natural anchor.
    const anchor = tasks
      .filter((t) => t.status === 'COMPLETED')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]
    if (!anchor) {
      return escalation('There is no completed work to review.')
    }

    const result = await this.ctx.runtime.run({
      taskId: anchor.id,
      agentId: judge.id,
      depth: 0,
      signal: controller.signal,
      promptOverride: prompt,
      systemPromptOverride: JUDGE_SYSTEM_PROMPT,
      suppressJudgeTools: true,
      manageTaskStatus: false
    })

    const parsed = parseVerdict(`${result.text}\n${result.summary}`)
    const rubric = this.ctx.evaluations.defaultRubric(projectId)
    const verdict = parsed
      ? normalizeVerdict(parsed, rubric.dimensions)
      : escalation('The Judge did not return a parseable project verdict.')

    const finalVerdict: JudgeVerdict = {
      ...verdict,
      decision: decide(verdict.score, {
        pass: rubric.passThreshold / 100,
        escalate: rubric.escalateThreshold / 100,
        judgeSaid: verdict.decision
      })
    }

    if (options.apply !== false) this.applyProjectVerdict(projectId, finalVerdict)
    return finalVerdict
  }

  private applyProjectVerdict(projectId: string, verdict: JudgeVerdict): void {
    const project = this.ctx.projects.get(projectId)
    const checklist = verdict.criteriaChecklist ?? []
    const byId = new Map(checklist.map((c) => [c.id, c]))

    const merged = (project.acceptanceCriteria ?? []).map((criterion) => {
      const found = byId.get(criterion.id)
      if (!found) {
        // Unmentioned criteria are treated as verified only on a clean approval.
        return { ...criterion, met: verdict.decision === 'APPROVED' ? true : criterion.met ?? null }
      }
      return { ...criterion, met: found.met ?? null, evidence: found.evidence }
    })
    this.ctx.projects.setCriteria(projectId, merged)

    if (verdict.decision === 'APPROVED') {
      this.ctx.bus.emit({
        type: 'JUDGE_APPROVED',
        projectId,
        message: `Project signed off at ${Math.round(verdict.score * 100)}%`,
        data: { scope: 'project', summary: verdict.summary }
      })
      this.ctx.projects.setStatus(projectId, 'COMPLETED')
      return
    }

    if (verdict.decision === 'ESCALATE') {
      this.ctx.bus.emit({
        type: 'JUDGE_ESCALATED',
        projectId,
        level: 'warn',
        message: 'Judge escalated the project sign-off to a human',
        data: { scope: 'project', summary: verdict.summary }
      })
      this.ctx.projects.setStatus(projectId, 'REVIEW')
      this.ctx.approvals.request({
        projectId,
        action: `Decide whether "${project.name}" is finished`,
        reason: verdict.summary,
        payload: { issues: verdict.issues }
      })
      return
    }

    this.ctx.bus.emit({
      type: 'JUDGE_REJECTED',
      projectId,
      level: 'warn',
      message: `Project not finished: ${verdict.requiredChanges.length} gaps remain`,
      data: { scope: 'project', requiredChanges: verdict.requiredChanges }
    })

    const priorAttempts = this.ctx.tasks
      .list(projectId)
      .filter((t) => t.context.projectGapFix === true).length

    const orchestrator = this.ctx.agents.orchestratorFor(projectId)
    if (!orchestrator || priorAttempts >= 3) {
      this.ctx.projects.setStatus(projectId, 'REVIEW')
      this.ctx.approvals.request({
        projectId,
        action: `"${project.name}" still has unmet acceptance criteria`,
        reason: verdict.summary,
        payload: { requiredChanges: verdict.requiredChanges, attempts: priorAttempts }
      })
      return
    }

    this.ctx.tasks.create({
      projectId,
      agentId: orchestrator.id,
      title: `Close the remaining gaps (round ${priorAttempts + 1})`,
      description:
        `The project was reviewed and is not finished. Unmet criteria and required changes:\n` +
        verdict.requiredChanges.map((c) => `- ${c}`).join('\n') +
        `\n\nIssues found:\n${verdict.issues.map((i) => `- ${i}`).join('\n')}\n\n` +
        `Work out which agents should address each gap, delegate the work, and wire any ` +
        `dependencies. Do not do the work yourself.`,
      acceptanceCriteria: verdict.requiredChanges,
      priority: 95,
      status: 'READY',
      requiresJudge: true,
      context: { projectGapFix: true }
    })
  }

  private async runJudge(
    judgeAgentId: string,
    taskId: string,
    evidence: string,
    dimensions: RubricDimension[],
    signal?: AbortSignal
  ): Promise<JudgeVerdict> {
    const task = this.ctx.tasks.get(taskId)
    const controller = new AbortController()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    const prompt = [
      `# Task under review\n${task.title}\n\n${task.description}`,
      task.acceptanceCriteria.length
        ? `\n# Acceptance criteria\n${task.acceptanceCriteria
            .map((c) => `- [${c.id}] ${c.text}`)
            .join('\n')}`
        : '\n# Acceptance criteria\nNone were specified. Judge against the task description, and note the missing criteria as an issue.',
      `\n# Rubric\n${dimensions.map((d) => `- ${d.name} (${Math.round(d.weight * 100)}%): ${d.description ?? ''}`).join('\n')}`,
      `\n# Evidence\n${evidence}`,
      `\nReturn only the JSON verdict object.`
    ].join('\n')

    const result = await this.ctx.runtime.run({
      taskId,
      agentId: judgeAgentId,
      depth: 0,
      signal: controller.signal,
      promptOverride: prompt,
      systemPromptOverride: JUDGE_SYSTEM_PROMPT,
      suppressJudgeTools: true,
      manageTaskStatus: false
    })

    const parsed = parseVerdict(`${result.text}\n${result.summary}`)
    if (!parsed) {
      return escalation(
        `The Judge did not return a parseable verdict. Raw output: ${result.text.slice(0, 400) || '(empty)'}`
      )
    }
    return normalizeVerdict(parsed, dimensions)
  }

  /** Assembles what actually happened, not what the agent said happened. */
  private async gatherEvidence(taskId: string, executionId: string | null): Promise<string> {
    const task = this.ctx.tasks.get(taskId)
    const parts: string[] = []

    const execution = executionId
      ? this.ctx.db.select().from(executionsTable).where(eq(executionsTable.id, executionId)).get()
      : this.ctx.db
          .select()
          .from(executionsTable)
          .where(eq(executionsTable.taskId, taskId))
          .orderBy(desc(executionsTable.startedAt))
          .get()

    if (execution) {
      parts.push(
        `## The agent's own claim\n${execution.summary ?? '(none)'}\n` +
          `Model: ${execution.model} · iterations: ${execution.iterations} · tool calls: ${execution.toolCallCount}` +
          (execution.error ? `\nReported error: ${execution.error}` : '')
      )
    }

    const toolEvents = execution
      ? this.ctx.db
          .select()
          .from(eventsTable)
          .where(
            and(
              eq(eventsTable.executionId, execution.id),
              eq(eventsTable.taskId, taskId)
            )
          )
          .orderBy(desc(eventsTable.createdAt))
          .limit(80)
          .all()
          .filter((e) => e.type.startsWith('TOOL_'))
      : []

    if (toolEvents.length) {
      parts.push(
        `## What it actually did (${toolEvents.length} tool events, newest first)\n` +
          toolEvents
            .slice(0, 40)
            .map((e) => `- ${e.type}: ${e.message}`)
            .join('\n')
      )
    } else {
      parts.push(
        `## What it actually did\nNo tool calls were recorded for this execution. Treat claims of ` +
          `file changes or test runs with suspicion.`
      )
    }

    const artifacts = this.ctx.artifacts.listByTask(taskId)
    if (artifacts.length) {
      const rendered: string[] = []
      for (const artifact of artifacts.slice(0, 12)) {
        let body = artifact.content ?? ''
        if (!body && artifact.path) {
          try {
            const stat = await fs.stat(artifact.path)
            body =
              stat.size > 40_000
                ? `(file exists, ${stat.size} bytes - too large to inline)`
                : await fs.readFile(artifact.path, 'utf8')
          } catch {
            body = '(claimed file does not exist on disk)'
          }
        }
        rendered.push(
          `### ${artifact.kind}: ${artifact.title}\n${body.slice(0, 6000) || '(empty)'}`
        )
      }
      parts.push(`## Artifacts\n${rendered.join('\n\n')}`)
    } else {
      parts.push('## Artifacts\nNone were produced.')
    }

    const priors = this.ctx.evaluations.listByTask(taskId)
    if (priors.length) {
      parts.push(
        `## Previous verdicts on this task\n` +
          priors
            .slice(0, 3)
            .map(
              (e) =>
                `- ${new Date(e.createdAt).toISOString()} ${e.decision} ${e.score}%: ${e.summary}`
            )
            .join('\n')
      )
    }

    if (task.revisionOfTaskId) {
      const prior = this.ctx.evaluations.latestForTask(task.revisionOfTaskId)
      if (prior) {
        parts.push(
          `## This is a revision\nThe previous attempt was rejected for:\n` +
            prior.requiredChanges.map((c) => `- ${c}`).join('\n') +
            `\nCheck specifically whether each of those was addressed.`
        )
      }
    }

    return parts.join('\n\n')
  }

  private apply(
    taskId: string,
    verdict: JudgeVerdict,
    executionId: string | null,
    judgeAgentId: string | null
  ): void {
    const task = this.ctx.tasks.get(taskId)
    const settings = this.ctx.projects.settings(task.projectId)

    this.ctx.evaluations.record({
      projectId: task.projectId,
      taskId,
      executionId,
      judgeAgentId,
      attempt: task.revisionCount,
      verdict
    })
    this.ctx.tasks.setScore(taskId, verdict.score)
    this.ctx.tasks.applyChecklist(taskId, verdict.criteriaChecklist)

    if (verdict.decision === 'APPROVED') {
      this.ctx.bus.emit({
        type: 'JUDGE_APPROVED',
        projectId: task.projectId,
        taskId,
        agentId: judgeAgentId,
        executionId,
        message: `Approved "${task.title}" at ${Math.round(verdict.score * 100)}%`,
        data: { score: verdict.score, summary: verdict.summary }
      })
      this.ctx.tasks.setStatus(taskId, 'COMPLETED', {
        result: { summary: verdict.summary, score: verdict.score }
      })
      this.ctx.memory.write({
        projectId: task.projectId,
        agentId: null,
        taskId,
        scope: 'project',
        kind: 'summary',
        key: `task:${taskId}`,
        content: `"${task.title}" was approved at ${Math.round(verdict.score * 100)}%: ${verdict.summary}`,
        importance: 60
      })
      return
    }

    if (verdict.decision === 'ESCALATE') {
      this.ctx.bus.emit({
        type: 'JUDGE_ESCALATED',
        projectId: task.projectId,
        taskId,
        agentId: judgeAgentId,
        executionId,
        level: 'warn',
        message: `Judge escalated "${task.title}" to a human`,
        data: { score: verdict.score, issues: verdict.issues }
      })
      this.ctx.tasks.setStatus(taskId, 'BLOCKED', {
        blockedReason: `Judge escalated: ${verdict.summary}`
      })
      this.ctx.approvals.request({
        projectId: task.projectId,
        agentId: task.agentId,
        taskId,
        action: `Decide on "${task.title}"`,
        reason: verdict.summary,
        payload: { verdict: verdict as unknown as Record<string, unknown> }
      })
      return
    }

    this.ctx.bus.emit({
      type: 'JUDGE_REJECTED',
      projectId: task.projectId,
      taskId,
      agentId: judgeAgentId,
      executionId,
      level: 'warn',
      message: `Rejected "${task.title}" at ${Math.round(verdict.score * 100)}% - ${verdict.requiredChanges.length} changes required`,
      data: {
        score: verdict.score,
        issues: verdict.issues,
        requiredChanges: verdict.requiredChanges
      }
    })

    if (!settings.autoRevise) {
      this.ctx.tasks.setStatus(taskId, 'REVIEW', { error: verdict.summary })
      return
    }

    try {
      const revision = this.ctx.tasks.createRevision(taskId, verdict)
      this.ctx.tasks.setStatus(taskId, 'COMPLETED', {
        result: {
          summary: `Superseded by revision ${revision.id}`,
          score: verdict.score,
          rejected: true
        }
      })
      this.ctx.messages.send({
        projectId: task.projectId,
        fromAgentId: judgeAgentId,
        toAgentId: task.agentId,
        taskId: revision.id,
        type: 'RESULT',
        priority: 80,
        content:
          `Your work on "${task.title}" was rejected at ${Math.round(verdict.score * 100)}%. ` +
          `Revision task created. Required changes:\n` +
          verdict.requiredChanges.map((c) => `- ${c}`).join('\n')
      })
    } catch {
      // Out of revisions: a human decides rather than looping forever.
      this.ctx.tasks.setStatus(taskId, 'FAILED', {
        error: `Rejected after exhausting revisions: ${verdict.summary}`
      })
      this.ctx.approvals.request({
        projectId: task.projectId,
        agentId: task.agentId,
        taskId,
        action: `"${task.title}" has exhausted its revisions`,
        reason: verdict.summary,
        payload: { requiredChanges: verdict.requiredChanges }
      })
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Pure helpers - unit tested directly                                         */
/* -------------------------------------------------------------------------- */

/**
 * Pulls the verdict object out of a model response that may include prose,
 * code fences, or the same object repeated more than once.
 */
export function parseVerdict(text: string): Partial<JudgeVerdict> | null {
  if (!text) return null

  const candidates: string[] = []
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1])
  }
  candidates.push(...extractJsonObjects(text))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<JudgeVerdict>
      if (typeof parsed === 'object' && parsed && ('score' in parsed || 'decision' in parsed)) {
        return parsed
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Every balanced top-level `{...}` region, string-aware. */
export function extractJsonObjects(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (char === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1))
        start = -1
      }
      if (depth < 0) depth = 0
    }
  }
  return out
}

export function normalizeVerdict(
  raw: Partial<JudgeVerdict>,
  dimensions: RubricDimension[] = DEFAULT_RUBRIC_DIMENSIONS
): JudgeVerdict {
  const criteria: CriterionScore[] = (raw.criteria ?? []).map((c) => ({
    name: String(c.name ?? 'Unnamed'),
    score: clamp01(Number(c.score ?? 0)),
    reason: String(c.reason ?? '')
  }))

  // Prefer the weighted rubric score over the model's own headline number, so a
  // judge cannot approve work while scoring every dimension poorly.
  const weighted = weightedScore(criteria, dimensions)
  const stated = raw.score == null ? null : clamp01(Number(raw.score))
  const score = weighted ?? stated ?? 0

  return {
    score,
    decision: (raw.decision as JudgeDecision) ?? 'REJECTED',
    criteria,
    issues: (raw.issues ?? []).map(String),
    requiredChanges: (raw.requiredChanges ?? []).map(String),
    summary: String(raw.summary ?? ''),
    criteriaChecklist: (raw.criteriaChecklist ?? (raw as { checklist?: AcceptanceCriterion[] }).checklist ?? []).map(
      (c, i) => ({
        id: String(c.id ?? `AC${i + 1}`),
        text: String(c.text ?? ''),
        met: c.met === true ? true : c.met === false ? false : null,
        evidence: c.evidence ? String(c.evidence) : undefined
      })
    )
  }
}

export function weightedScore(
  criteria: CriterionScore[],
  dimensions: RubricDimension[]
): number | null {
  if (!criteria.length) return null
  let total = 0
  let weight = 0
  for (const criterion of criteria) {
    const dimension = dimensions.find(
      (d) => d.name.toLowerCase() === criterion.name.toLowerCase()
    )
    const w = dimension?.weight ?? 1 / dimensions.length
    total += criterion.score * w
    weight += w
  }
  return weight > 0 ? clamp01(total / weight) : null
}

export function decide(
  score: number,
  thresholds: { pass: number; escalate: number; judgeSaid?: JudgeDecision }
): JudgeDecision {
  if (thresholds.judgeSaid === 'ESCALATE') return 'ESCALATE'
  if (score < thresholds.escalate) return 'ESCALATE'
  return score >= thresholds.pass ? 'APPROVED' : 'REJECTED'
}

/** Mean score across a panel; issues and required changes are unioned. */
export function aggregateVerdicts(verdicts: JudgeVerdict[]): JudgeVerdict {
  if (!verdicts.length) return escalation('No judge produced a verdict.')
  if (verdicts.length === 1) return verdicts[0]

  const score = verdicts.reduce((a, v) => a + v.score, 0) / verdicts.length
  const decision: JudgeDecision = verdicts.some((v) => v.decision === 'ESCALATE')
    ? 'ESCALATE'
    : verdicts.every((v) => v.decision === 'APPROVED')
      ? 'APPROVED'
      : 'REJECTED'

  return {
    score,
    decision,
    criteria: verdicts.flatMap((v) => v.criteria),
    issues: unique(verdicts.flatMap((v) => v.issues)),
    requiredChanges: unique(verdicts.flatMap((v) => v.requiredChanges)),
    summary: verdicts.map((v) => v.summary).join(' | '),
    criteriaChecklist: verdicts[0].criteriaChecklist
  }
}

function escalation(reason: string): JudgeVerdict {
  return {
    score: 0,
    decision: 'ESCALATE',
    criteria: [],
    issues: [reason],
    requiredChanges: [],
    summary: reason,
    criteriaChecklist: []
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  // Tolerate judges that answer in percent.
  const normalized = value > 1 && value <= 100 ? value / 100 : value
  return Math.max(0, Math.min(1, normalized))
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
