import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Markdown } from '../components/Markdown'
import { Collapsible } from '../components/Collapsible'
import { Changelog } from '../components/Changelog'
import { Button } from '../ui'
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
        <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
        <Markdown className="mt-1">{statusLine(project, stats, agents.length, met)}</Markdown>

        <Brief project={project} />

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

        <Collapsible title="Progress" autoCollapseAbove={9999}>
          <SegmentBar segments={buckets} />
        </Collapsible>

        <Criteria project={project} met={met} />

        <Collapsible
          title="Judge verdicts over time"
          aside={`pass at ${Math.round(project.settings.judgePassThreshold * 100)}%`}
          autoCollapseAbove={9999}
        >
          <ScoreTrend points={scorePoints} threshold={project.settings.judgePassThreshold} />
        </Collapsible>

        <Collapsible title="Changelog" aside="derived from what happened">
          <Changelog />
        </Collapsible>

        {spend.length > 0 && (
          <Collapsible title="Spend by agent">
            <BarList data={spend} format={formatCost} />
          </Collapsible>
        )}

        {activity.length > 0 && (
          <Collapsible title="Activity" aside={`${store.events.length} events`}>
            <Sparkline values={activity} />
          </Collapsible>
        )}

        <Collapsible title="Fleet">
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
        </Collapsible>

        <Collapsible title="Live activity" aside="newest first">
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
        </Collapsible>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The editable parts                                                  */
/* ------------------------------------------------------------------ */

/**
 * The mission, rendered as markdown and editable in place.
 *
 * A mission is the one piece of text everything else is judged against, so it
 * has to be correctable without leaving the page you noticed the problem on.
 */
function Brief({ project }: { project: Project }): React.JSX.Element {
  const store = useStore()
  const [editing, setEditing] = useState(false)
  const [mission, setMission] = useState(project.mission)
  const [instructions, setInstructions] = useState(project.instructions)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await api.projects.update(project.id, { mission, instructions })
      await store.refreshProjects()
      setEditing(false)
    } catch (err) {
      useStore.setState({ error: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Collapsible
      title="Mission"
      actions={
        editing ? (
          <span className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMission(project.mission)
                setInstructions(project.instructions)
                setEditing(false)
              }}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )
      }
    >
      {editing ? (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-2xs uppercase tracking-wider text-ink-faint">
              Mission · markdown
            </span>
            <textarea
              rows={8}
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              className="w-full font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs uppercase tracking-wider text-ink-faint">
              Standing instructions · markdown
            </span>
            <textarea
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="w-full font-mono text-xs"
            />
          </label>
        </div>
      ) : (
        <>
          <Markdown>{project.mission || '_No mission set._'}</Markdown>
          {project.instructions.trim() && (
            <div className="mt-3 rounded-lg border border-edge bg-base-850 px-3 py-2">
              <div className="mb-1 text-2xs uppercase tracking-wider text-ink-faint">
                Standing instructions
              </div>
              <Markdown>{project.instructions}</Markdown>
            </div>
          )}
        </>
      )}
    </Collapsible>
  )
}

/**
 * Acceptance criteria, editable as one criterion per line.
 *
 * Edited as text rather than as a list of rows because that is how people write
 * them, and because reordering, merging and splitting are all just typing. The
 * `met` flag is preserved by matching on text, so correcting a typo does not
 * silently un-meet a criterion the Judge has already signed off.
 */
function Criteria({ project, met }: { project: Project; met: number }): React.JSX.Element {
  const store = useStore()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(project.acceptanceCriteria.map((c) => c.text).join('\n'))
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const lines = text
        .split('\n')
        .map((line) => line.replace(/^[-*]\s+/, '').trim())
        .filter(Boolean)
      const previous = new Map(project.acceptanceCriteria.map((c) => [c.text, c]))
      const acceptanceCriteria = lines.map((line, index) => {
        const kept = previous.get(line)
        return kept ?? { id: `ac_${Date.now()}_${index}`, text: line, met: false }
      })
      await api.projects.update(project.id, { acceptanceCriteria })
      await store.refreshProjects()
      setEditing(false)
    } catch (err) {
      useStore.setState({ error: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Collapsible
      title="Acceptance criteria"
      aside={`${met}/${project.acceptanceCriteria.length} met`}
      actions={
        editing ? (
          <span className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(project.acceptanceCriteria.map((c) => c.text).join('\n'))
                setEditing(false)
              }}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )
      }
    >
      {editing ? (
        <textarea
          rows={Math.max(6, project.acceptanceCriteria.length + 2)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One criterion per line."
          className="w-full font-mono text-xs"
        />
      ) : project.acceptanceCriteria.length === 0 ? (
        <p className="text-xs text-ink-faint">
          None set. Without criteria the Judge has nothing to score the project against.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {project.acceptanceCriteria.map((criterion) => (
            <li key={criterion.id} className="flex items-start gap-2 text-sm">
              <span className={clsx('mt-0.5', criterion.met ? 'text-good' : 'text-ink-faint')}>
                {criterion.met ? '✓' : '○'}
              </span>
              <span className={clsx('min-w-0 flex-1', criterion.met ? 'text-ink-dim' : 'text-ink-faint')}>
                <Markdown>{criterion.text}</Markdown>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  )
}

/** The generated status line, as distinct from the authored mission. */
function statusLine(
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
    status,
    '',
    judged,
    project.settings.isolateAgentWorkspaces
      ? ' Each agent works on its own git branch, so concurrent edits cannot overwrite one another.'
      : ' Agents share one checkout; turn on workspace isolation in Settings if they will edit the same files.'
  ].join('\n')
}
