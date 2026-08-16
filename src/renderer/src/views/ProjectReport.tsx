import React, { useMemo } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { Markdown } from '../components/Markdown'
import { BarList, ScoreTrend, SegmentBar, Sparkline, Tile, VIZ } from '../components/Charts'
import { RobotAvatar } from '../components/RobotAvatar'
import { formatCost, formatRelative, formatTokens, ScoreBadge } from '../ui'
import type { Project } from '@shared/models'

/**
 * A live report on the project, assembled from what actually happened.
 *
 * Nothing here is authored: the prose is generated from the same rows the rest
 * of the application reads, so it cannot drift from the truth and there is no
 * "last updated" to distrust. It is the document you would otherwise ask an
 * agent to write for you every morning.
 */
export function ProjectReport({ projectId }: { projectId: string }): React.JSX.Element {
  const store = useStore()
  const project = store.projects.find((p) => p.id === projectId) ?? null

  const tasks = store.tasks
  const agents = store.agents
  const stats = store.stats

  const buckets = useMemo(() => {
    const count = (statuses: string[]): number =>
      tasks.filter((t) => statuses.includes(t.status)).length
    return [
      { label: 'Completed', value: count(['COMPLETED']), color: VIZ.good },
      { label: 'In flight', value: count(['RUNNING', 'QUEUED']), color: VIZ.series },
      {
        label: 'Waiting',
        value: count(['BACKLOG', 'READY', 'REVIEW', 'BLOCKED']),
        color: VIZ.muted
      },
      { label: 'Failed', value: count(['FAILED', 'CANCELLED']), color: VIZ.bad }
    ]
  }, [tasks])

  const scorePoints = useMemo(
    () =>
      [...store.evaluations]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-24)
        .map((evaluation) => ({
          at: evaluation.createdAt,
          score: evaluation.score / 100,
          approved: evaluation.decision === 'APPROVED',
          label: tasks.find((t) => t.id === evaluation.taskId)?.title ?? 'task'
        })),
    [store.evaluations, tasks]
  )

  // Events per bucket over the window the store holds, as a shape rather than a
  // series with meaningful units - it answers "is anything happening".
  const activity = useMemo(() => {
    if (store.events.length < 2) return []
    const times = store.events.map((e) => e.createdAt)
    const from = Math.min(...times)
    const to = Math.max(...times)
    const span = Math.max(to - from, 1)
    const bins = new Array(40).fill(0)
    for (const time of times) {
      bins[Math.min(39, Math.floor(((time - from) / span) * 40))] += 1
    }
    return bins
  }, [store.events])

  const spend = useMemo(
    () =>
      store.fleet.agents
        .filter((a) => a.projectId === projectId && (a.costUsd > 0 || a.tokens > 0))
        .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens)
        .slice(0, 8)
        .map((a) => ({ label: a.name, value: a.costUsd, hint: `${formatTokens(a.tokens)} tokens` })),
    [store.fleet.agents, projectId]
  )

  if (!project) {
    return <p className="p-6 text-sm text-ink-faint">That project is no longer available.</p>
  }

  const met = project.acceptanceCriteria.filter((c) => c.met).length
  const recent = [...store.events].slice(0, 40)

  return (
    <div className="scroll-y h-full min-h-0">
      <div className="mx-auto max-w-4xl px-8 py-6">
        <Markdown>{narrative(project, stats, agents.length, met)}</Markdown>

        <div className="my-5 grid grid-cols-4 gap-2">
          <Tile label="Agents" value={agents.length} hint={`${stats?.agentsRunning ?? 0} running`} />
          <Tile
            label="Tasks"
            value={tasks.length}
            hint={`${buckets[0].value} complete`}
            tone={buckets[3].value > 0 ? 'bad' : undefined}
          />
          <Tile
            label="Judge"
            value={stats?.averageScore == null ? '—' : `${Math.round(stats.averageScore * 100)}%`}
            hint={`${store.evaluations.length} verdicts`}
            tone={
              stats?.averageScore == null
                ? undefined
                : stats.averageScore >= project.settings.judgePassThreshold
                  ? 'good'
                  : 'warn'
            }
          />
          <Tile
            label="Spend"
            value={formatCost(stats?.costUsd ?? 0)}
            hint={`${formatTokens((stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0))} tokens`}
          />
        </div>

        <Section title="Progress">
          <SegmentBar segments={buckets} />
        </Section>

        {project.acceptanceCriteria.length > 0 && (
          <Section
            title="Acceptance criteria"
            aside={`${met}/${project.acceptanceCriteria.length} met`}
          >
            <ul className="space-y-1.5">
              {project.acceptanceCriteria.map((criterion) => (
                <li key={criterion.id} className="flex items-start gap-2 text-sm">
                  <span className={clsx('mt-0.5', criterion.met ? 'text-good' : 'text-ink-faint')}>
                    {criterion.met ? '✓' : '○'}
                  </span>
                  <span className={criterion.met ? 'text-ink-dim' : 'text-ink-faint'}>
                    {criterion.text}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          title="Judge verdicts over time"
          aside={`pass at ${Math.round(project.settings.judgePassThreshold * 100)}%`}
        >
          <ScoreTrend points={scorePoints} threshold={project.settings.judgePassThreshold} />
        </Section>

        {spend.length > 0 && (
          <Section title="Spend by agent">
            <BarList data={spend} format={formatCost} />
          </Section>
        )}

        {activity.length > 0 && (
          <Section title="Activity" aside={`${store.events.length} events`}>
            <Sparkline values={activity} />
          </Section>
        )}

        <Section title="Fleet">
          <div className="space-y-1">
            {agents.map((agent) => {
              const fleetAgent = store.fleet.agents.find((a) => a.id === agent.id)
              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    store.selectAgent(agent.id)
                    store.openTab({
                      kind: 'agent',
                      projectId,
                      agentId: agent.id,
                      title: agent.name
                    })
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left row-hover"
                  style={{ paddingLeft: 8 + Math.min(agent.depth, 4) * 14 }}
                >
                  <RobotAvatar seed={agent.id} size={22} status={agent.status} />
                  <span className="truncate text-sm text-ink-dim">{agent.name}</span>
                  <span className="truncate text-2xs text-ink-faint">{agent.description}</span>
                  <span className="flex-1" />
                  {fleetAgent?.lastScore != null && <ScoreBadge score={fleetAgent.lastScore} />}
                  <span className="w-14 shrink-0 text-right text-2xs text-ink-faint">
                    {formatRelative(agent.lastActiveAt)}
                  </span>
                </button>
              )
            })}
          </div>
        </Section>

        <Section title="Live activity" aside="newest first">
          <div className="space-y-0.5">
            {recent.length === 0 && <p className="text-xs text-ink-faint">Nothing yet.</p>}
            {recent.map((event) => (
              <div key={event.id} className="flex items-baseline gap-2 text-2xs">
                <span className="w-14 shrink-0 font-mono text-ink-faint">
                  {new Date(event.createdAt).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
                <span
                  className={clsx(
                    'w-40 shrink-0 truncate font-mono',
                    event.level === 'error'
                      ? 'text-bad'
                      : event.level === 'warn'
                        ? 'text-warn'
                        : 'text-ink-faint'
                  )}
                >
                  {event.type}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-dim">{event.message}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  aside,
  children
}: {
  title: string
  aside?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="my-5">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-2xs uppercase tracking-wider text-ink-faint">{title}</h3>
        <span className="flex-1 border-b border-edge" />
        {aside && <span className="text-2xs text-ink-faint">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/** The written part of the report, generated rather than authored. */
function narrative(
  project: Project,
  stats: ReturnType<typeof useStore.getState>['stats'],
  agentCount: number,
  met: number
): string {
  const criteria = project.acceptanceCriteria.length
  const progress = Math.round((stats?.progress ?? 0) * 100)

  const status =
    project.status === 'COMPLETED'
      ? `**Signed off.** The Judge checked the finished work against the project's own acceptance criteria and found ${met} of ${criteria} met.`
      : project.status === 'ACTIVE'
        ? `**Running.** ${stats?.agentsRunning ?? 0} of ${agentCount} agents are working right now, and the board is ${progress}% complete.`
        : project.status === 'REVIEW'
          ? '**In review.** The board has emptied and the project is being checked against its acceptance criteria.'
          : project.status === 'PAUSED'
            ? '**Paused.** Nothing will start until you resume it.'
            : '**Draft.** Launch it and the Orchestrator will plan the work and staff a fleet.'

  const judged =
    stats?.averageScore == null
      ? 'No work has been judged yet.'
      : `Judged work averages ${Math.round(stats.averageScore * 100)}%, against a pass mark of ${Math.round(
          project.settings.judgePassThreshold * 100
        )}%.`

  return [
    `# ${project.name}`,
    '',
    project.mission || project.description || '_No mission set._',
    '',
    status,
    '',
    judged,
    project.settings.isolateAgentWorkspaces
      ? ' Each agent works on its own git branch, so concurrent edits cannot overwrite one another.'
      : ' Agents share one checkout; turn on workspace isolation in Settings if they will edit the same files.'
  ].join('\n')
}
