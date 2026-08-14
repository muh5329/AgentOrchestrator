import React from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import {
  Badge,
  Button,
  EmptyState,
  Meter,
  Panel,
  ScoreBadge,
  Stat,
  StatusDot,
  formatCost,
  formatRelative,
  formatTokens
} from '../ui'

const BOARD_ORDER = [
  'BACKLOG',
  'READY',
  'QUEUED',
  'RUNNING',
  'REVIEW',
  'BLOCKED',
  'FAILED',
  'COMPLETED'
] as const

export function Dashboard(): React.JSX.Element {
  const store = useStore()
  const project = store.projects.find((p) => p.id === store.activeProjectId)
  const stats = store.stats

  if (!project) return <EmptyState title="No project" />

  const running = store.agents.filter((a) => a.status === 'RUNNING')
  const recentVerdicts = store.evaluations.slice(0, 6)
  const criteria = project.acceptanceCriteria ?? []
  const met = criteria.filter((c) => c.met === true).length

  return (
    <div className="scroll-y h-full p-3">
      <div className="mb-3 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-ink-dim">
            {project.mission || 'No mission set.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {project.status === 'DRAFT' && (
            <Button
              variant="primary"
              onClick={async () => {
                await api.projects.launch(project.id)
                await store.refreshProject()
                await store.refreshProjects()
              }}
            >
              Launch Orchestrator
            </Button>
          )}
          <Button onClick={() => void store.refreshProject()}>Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Agents" value={stats?.agents ?? 0} hint={`${running.length} running`} />
        <Stat
          label="Tasks"
          value={stats?.tasksTotal ?? 0}
          hint={`${stats?.tasksByStatus.COMPLETED ?? 0} complete`}
        />
        <Stat
          label="In review"
          value={stats?.pendingReviews ?? 0}
          tone={stats?.pendingReviews ? 'warn' : undefined}
          hint="awaiting the Judge"
        />
        <Stat
          label="Failed"
          value={stats?.tasksByStatus.FAILED ?? 0}
          tone={stats?.tasksByStatus.FAILED ? 'bad' : undefined}
        />
        <Stat
          label="Judge score"
          value={stats?.averageScore == null ? '—' : `${Math.round(stats.averageScore * 100)}%`}
          tone={
            stats?.averageScore == null
              ? undefined
              : stats.averageScore >= 0.8
                ? 'good'
                : stats.averageScore >= 0.5
                  ? 'warn'
                  : 'bad'
          }
          hint={`${store.evaluations.length} verdicts`}
        />
        <Stat
          label="Spend"
          value={formatCost(stats?.costUsd ?? 0)}
          hint={`${formatTokens((stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0))} tokens`}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="Progress" className="xl:col-span-2">
          <div className="flex items-center gap-3">
            <Meter value={stats?.progress ?? 0} tone="accent" className="h-1.5" />
            <span className="mono text-xs tabular-nums text-ink-dim">
              {Math.round((stats?.progress ?? 0) * 100)}%
            </span>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5 md:grid-cols-8">
            {BOARD_ORDER.map((status) => (
              <div key={status} className="rounded border border-edge bg-base-800 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-ink-faint">
                  <StatusDot status={status} />
                  {status}
                </div>
                <div className="mt-0.5 text-md tabular-nums">
                  {stats?.tasksByStatus[status] ?? 0}
                </div>
              </div>
            ))}
          </div>

          {criteria.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wider text-ink-faint">
                  Project acceptance criteria
                </span>
                <span className="mono text-xs text-ink-dim">
                  {met}/{criteria.length} met
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {criteria.map((criterion) => (
                  <li key={criterion.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={clsx(
                        'mt-0.5 mono text-xs',
                        criterion.met === true
                          ? 'text-good'
                          : criterion.met === false
                            ? 'text-bad'
                            : 'text-ink-faint'
                      )}
                    >
                      {criterion.met === true ? '✓' : criterion.met === false ? '✗' : '○'}
                    </span>
                    <span className={criterion.met === true ? 'text-ink-dim' : 'text-ink'}>
                      {criterion.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Running now" dense>
          {running.length === 0 ? (
            <p className="p-3 text-xs text-ink-faint">Nothing is running.</p>
          ) : (
            <div className="scroll-y max-h-64">
              {running.map((agent) => {
                const task = store.tasks.find(
                  (t) => t.agentId === agent.id && t.status === 'RUNNING'
                )
                return (
                  <button
                    key={agent.id}
                    onClick={() => {
                      store.selectAgent(agent.id)
                      store.setView('agents')
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left row-hover"
                  >
                    <StatusDot status="RUNNING" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{agent.name}</div>
                      <div className="truncate text-xs text-ink-faint">
                        {task?.title ?? 'starting…'}
                      </div>
                    </div>
                    <span className="mono text-2xs text-ink-faint">d{agent.depth}</span>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Recent verdicts" dense>
          {recentVerdicts.length === 0 ? (
            <p className="p-3 text-xs text-ink-faint">The Judge has not ruled on anything yet.</p>
          ) : (
            <div className="scroll-y max-h-72">
              {recentVerdicts.map((evaluation) => {
                const task = store.tasks.find((t) => t.id === evaluation.taskId)
                return (
                  <button
                    key={evaluation.id}
                    onClick={() => {
                      store.selectTask(evaluation.taskId)
                      store.setView('tasks')
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left row-hover"
                  >
                    <Badge
                      tone={
                        evaluation.decision === 'APPROVED'
                          ? 'good'
                          : evaluation.decision === 'ESCALATE'
                            ? 'magic'
                            : 'warn'
                      }
                    >
                      {evaluation.decision}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{task?.title ?? evaluation.taskId}</div>
                      <div className="truncate text-xs text-ink-faint">{evaluation.summary}</div>
                    </div>
                    <ScoreBadge score={evaluation.score / 100} />
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title="Fleet" dense>
          <div className="scroll-y max-h-72">
            {store.agents.map((agent) => {
              const tasks = store.tasks.filter((t) => t.agentId === agent.id)
              const open = tasks.filter(
                (t) => !['COMPLETED', 'CANCELLED'].includes(t.status)
              ).length
              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    store.selectAgent(agent.id)
                    store.setView('agents')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left row-hover"
                >
                  <span style={{ width: agent.depth * 12 }} />
                  <StatusDot status={agent.status} />
                  <span className="min-w-0 flex-1 truncate text-sm">{agent.name}</span>
                  {agent.isBuiltIn && <Badge>built-in</Badge>}
                  <span className="mono text-2xs text-ink-faint">{open} open</span>
                  <span className="w-20 truncate text-right text-2xs text-ink-faint">
                    {formatRelative(agent.lastActiveAt)}
                  </span>
                </button>
              )
            })}
          </div>
        </Panel>
      </div>
    </div>
  )
}
