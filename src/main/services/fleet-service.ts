import { sql } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import type { FleetAgent, FleetOverview, FleetProject } from '@shared/models'
import { executions, tasks as tasksTable } from '../db/schema'

/**
 * The sessions rail shows every agent in every project at once, which the
 * per-project services deliberately do not do. Fetching them project by project
 * would be N round trips and N x M queries; this rolls the whole fleet up in
 * three aggregate queries and one pass over the agent rows.
 */
export class FleetService {
  constructor(private readonly ctx: AppContext) {}

  overview(): FleetOverview {
    const taskRollup = this.taskRollup()
    const costRollup = this.costRollup()

    const projects: FleetProject[] = []
    const agents: FleetAgent[] = []

    for (const project of this.ctx.projects.list()) {
      // The branch an agent works on is derived, not stored, so it can be named
      // without touching git - but only claim it when isolation is actually on.
      const isolated = project.settings.isolateAgentWorkspaces === true

      let projectCost = 0
      let projectOpen = 0
      let projectRunning = 0
      let projectDone = 0
      let projectTotal = 0
      let agentCount = 0

      for (const agent of this.ctx.agents.list(project.id)) {
        const counts = taskRollup.get(agent.id) ?? EMPTY_COUNTS
        const cost = costRollup.get(agent.id) ?? EMPTY_COST

        agents.push({
          ...agent,
          openTasks: counts.open,
          runningTasks: counts.running,
          completedTasks: counts.completed,
          totalTasks: counts.total,
          lastScore: counts.lastScore,
          costUsd: cost.costUsd,
          tokens: cost.tokens,
          branch: isolated ? this.ctx.git.branchNameFor(agent.name, agent.id) : null
        })

        agentCount += 1
        projectCost += cost.costUsd
        projectOpen += counts.open
        projectRunning += counts.running
        projectDone += counts.completed
        projectTotal += counts.total
      }

      projects.push({
        ...project,
        agentCount,
        openTasks: projectOpen,
        runningTasks: projectRunning,
        completedTasks: projectDone,
        totalTasks: projectTotal,
        costUsd: projectCost
      })
    }

    return { projects, agents }
  }

  /** Task counts and the most recent judge score, per agent, in one query. */
  private taskRollup(): Map<string, Counts> {
    const rows = this.ctx.db
      .select({
        agentId: tasksTable.agentId,
        status: tasksTable.status,
        score: tasksTable.score,
        updatedAt: tasksTable.updatedAt
      })
      .from(tasksTable)
      .all()

    const out = new Map<string, Counts & { scoredAt: number }>()
    for (const row of rows) {
      if (!row.agentId) continue
      const entry =
        out.get(row.agentId) ??
        ({ open: 0, running: 0, completed: 0, total: 0, lastScore: null, scoredAt: -1 } as Counts & {
          scoredAt: number
        })

      entry.total += 1
      if (row.status === 'RUNNING') entry.running += 1
      if (row.status === 'COMPLETED') entry.completed += 1
      if (row.status !== 'COMPLETED' && row.status !== 'CANCELLED') entry.open += 1

      // Scores are stored as integer percent; the UI works in 0-1.
      if (row.score != null && row.updatedAt > entry.scoredAt) {
        entry.lastScore = row.score / 100
        entry.scoredAt = row.updatedAt
      }
      out.set(row.agentId, entry)
    }
    return out as Map<string, Counts>
  }

  /** Spend and tokens per agent. Costs are stored in micro-dollars. */
  private costRollup(): Map<string, Cost> {
    const rows = this.ctx.db
      .select({
        agentId: executions.agentId,
        costUsd: sql<number>`sum(${executions.costUsd})`,
        tokens: sql<number>`sum(${executions.inputTokens} + ${executions.outputTokens})`
      })
      .from(executions)
      .groupBy(executions.agentId)
      .all()

    const out = new Map<string, Cost>()
    for (const row of rows) {
      out.set(row.agentId, {
        costUsd: (row.costUsd ?? 0) / 1_000_000,
        tokens: row.tokens ?? 0
      })
    }
    return out
  }
}

interface Counts {
  open: number
  running: number
  completed: number
  total: number
  lastScore: number | null
}

interface Cost {
  costUsd: number
  tokens: number
}

const EMPTY_COUNTS: Counts = { open: 0, running: 0, completed: 0, total: 0, lastScore: null }
const EMPTY_COST: Cost = { costUsd: 0, tokens: 0 }
