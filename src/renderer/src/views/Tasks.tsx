import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Panel,
  ScoreBadge,
  StatusDot,
  Tabs,
  formatCost,
  formatRelative
} from '../ui'
import type { TaskStatus } from '@shared/domain'
import type { Artifact, Evaluation, Execution, Task } from '@shared/models'

const COLUMNS: TaskStatus[] = [
  'BACKLOG',
  'READY',
  'RUNNING',
  'REVIEW',
  'BLOCKED',
  'FAILED',
  'COMPLETED'
]

/** Statuses a human may set by dragging. The rest are the runtime's to assign. */
const DROPPABLE: TaskStatus[] = ['BACKLOG', 'READY', 'BLOCKED', 'CANCELLED']

export function TasksView(): React.JSX.Element {
  const store = useStore()
  const [agentFilter, setAgentFilter] = useState('')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const tasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return store.tasks.filter((task) => {
      if (agentFilter && task.agentId !== agentFilter) return false
      if (!needle) return true
      return `${task.title} ${task.description}`.toLowerCase().includes(needle)
    })
  }, [store.tasks, agentFilter, query])

  const selected = store.tasks.find((t) => t.id === store.selectedTaskId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks…"
          className="h-7 w-56 text-xs"
        />
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="h-7 text-xs"
        >
          <option value="">All agents</option>
          {store.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-ink-faint">{tasks.length} tasks</span>
        <Button size="sm" onClick={() => setCreating(true)}>
          New task
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex h-full min-w-max gap-2 p-2">
            {COLUMNS.map((status) => (
              <Column key={status} status={status} tasks={tasks.filter((t) => t.status === status)} />
            ))}
          </div>
        </div>

        {selected && (
          <div className="w-[30rem] shrink-0 border-l border-edge">
            <TaskDetail task={selected} />
          </div>
        )}
      </div>

      <NewTaskModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function Column({ status, tasks }: { status: TaskStatus; tasks: Task[] }): React.JSX.Element {
  const store = useStore()
  const [over, setOver] = useState(false)
  const droppable = DROPPABLE.includes(status)

  return (
    <div
      className={clsx(
        'flex w-64 shrink-0 flex-col rounded-lg border bg-base-850/60',
        over && droppable ? 'border-accent' : 'border-edge'
      )}
      onDragOver={(e) => {
        if (!droppable) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        setOver(false)
        if (!droppable) return
        const taskId = e.dataTransfer.getData('text/task-id')
        if (!taskId) return
        await api.tasks.setStatus(taskId, status)
        await store.refreshProject()
      }}
    >
      <header className="flex items-center gap-1.5 border-b border-edge px-2.5 py-1.5">
        <StatusDot status={status} />
        <span className="text-2xs uppercase tracking-wider text-ink-dim">{status}</span>
        <span className="ml-auto mono text-2xs text-ink-faint">{tasks.length}</span>
      </header>

      <div className="scroll-y flex-1 p-1.5">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {!tasks.length && <p className="px-2 py-3 text-2xs text-ink-faint">Empty</p>}
      </div>
    </div>
  )
}

function TaskCard({ task }: { task: Task }): React.JSX.Element {
  const store = useStore()
  const agent = store.agents.find((a) => a.id === task.agentId)
  const met = task.acceptanceCriteria.filter((c) => c.met === true).length

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/task-id', task.id)}
      onClick={() => store.selectTask(task.id)}
      className={clsx(
        'mb-1.5 cursor-pointer rounded border bg-base-800 px-2 py-1.5 transition-colors',
        task.id === store.selectedTaskId
          ? 'border-accent'
          : 'border-edge hover:border-edge-bright'
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 text-sm leading-snug">{task.title}</span>
        <ScoreBadge score={task.score == null ? null : task.score / 100} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-ink-faint">
        {agent ? <span className="truncate">{agent.name}</span> : <span>unassigned</span>}
        {task.revisionOfTaskId && <Badge tone="warn">revision {task.revisionCount}</Badge>}
        {task.acceptanceCriteria.length > 0 && (
          <span className="mono">
            {met}/{task.acceptanceCriteria.length} AC
          </span>
        )}
        {task.priority !== 50 && <span className="mono">p{task.priority}</span>}
      </div>
    </div>
  )
}

function TaskDetail({ task }: { task: Task }): React.JSX.Element {
  const store = useStore()
  const [tab, setTab] = useState<'detail' | 'runs' | 'verdicts' | 'artifacts'>('detail')
  const [executions, setExecutions] = useState<Execution[]>([])
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [dependencies, setDependencies] = useState<{ dependsOn: string[]; blocks: string[] }>({
    dependsOn: [],
    blocks: []
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.executions.byTask(task.id).then(setExecutions)
    void api.evaluations.byTask(task.id).then(setEvaluations)
    void api.artifacts.byTask(task.id).then(setArtifacts)
    void api.tasks.dependencies(task.id).then(setDependencies)
  }, [task.id, task.status, task.updatedAt])

  const agent = store.agents.find((a) => a.id === task.agentId)
  const canRun = Boolean(task.agentId) && !['RUNNING', 'QUEUED', 'COMPLETED'].includes(task.status)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-edge px-3 py-2.5">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-md font-medium leading-snug">{task.title}</h2>
          <Button size="sm" variant="ghost" onClick={() => store.selectTask(null)}>
            ✕
          </Button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <StatusDot status={task.status} />
          <span>{task.status}</span>
          {agent && (
            <button
              className="text-accent"
              onClick={() => {
                store.selectAgent(agent.id)
                store.setView('agents')
              }}
            >
              {agent.name}
            </button>
          )}
          <span>·</span>
          <span>{formatRelative(task.updatedAt)}</span>
          {task.requiresJudge && <Badge tone="magic">judged</Badge>}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="primary"
            disabled={!canRun || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.tasks.run(task.id)
              } finally {
                setBusy(false)
              }
            }}
          >
            Run
          </Button>
          <Button
            size="sm"
            disabled={!['RUNNING', 'QUEUED'].includes(task.status)}
            onClick={() => void api.tasks.stop(task.id)}
          >
            Stop
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.tasks.judge(task.id, true)
                setEvaluations(await api.evaluations.byTask(task.id))
                await store.refreshProject()
              } finally {
                setBusy(false)
              }
            }}
          >
            Judge now
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={['COMPLETED', 'CANCELLED'].includes(task.status)}
            onClick={() => void api.tasks.cancel(task.id, 'Cancelled by the operator')}
          >
            Cancel
          </Button>
        </div>
      </header>

      <div className="border-b border-edge px-2 py-1.5">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'detail', label: 'Detail' },
            { id: 'runs', label: `Runs ${executions.length}` },
            { id: 'verdicts', label: `Verdicts ${evaluations.length}` },
            { id: 'artifacts', label: `Artifacts ${artifacts.length}` }
          ]}
        />
      </div>

      <div className="scroll-y min-h-0 flex-1 p-3">
        {tab === 'detail' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-2xs uppercase tracking-wider text-ink-faint">Description</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-dim">{task.description}</p>
            </div>

            {task.acceptanceCriteria.length > 0 && (
              <div>
                <div className="text-2xs uppercase tracking-wider text-ink-faint">
                  Acceptance criteria
                </div>
                <ul className="mt-1 flex flex-col gap-1">
                  {task.acceptanceCriteria.map((criterion) => (
                    <li key={criterion.id} className="flex items-start gap-2 text-sm">
                      <span
                        className={clsx(
                          'mono text-xs',
                          criterion.met === true
                            ? 'text-good'
                            : criterion.met === false
                              ? 'text-bad'
                              : 'text-ink-faint'
                        )}
                      >
                        {criterion.met === true ? '✓' : criterion.met === false ? '✗' : '○'}
                      </span>
                      <span className="min-w-0">
                        <span>{criterion.text}</span>
                        {criterion.evidence && (
                          <span className="block text-xs text-ink-faint">{criterion.evidence}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {task.blockedReason && (
              <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                {task.blockedReason}
              </div>
            )}
            {task.error && (
              <div className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
                {task.error}
              </div>
            )}

            {(dependencies.dependsOn.length > 0 || dependencies.blocks.length > 0) && (
              <div>
                <div className="text-2xs uppercase tracking-wider text-ink-faint">Dependencies</div>
                <div className="mt-1 flex flex-col gap-1 text-sm">
                  {dependencies.dependsOn.map((id) => (
                    <button
                      key={id}
                      className="text-left text-ink-dim hover:text-ink"
                      onClick={() => store.selectTask(id)}
                    >
                      waits for → {store.tasks.find((t) => t.id === id)?.title ?? id}
                    </button>
                  ))}
                  {dependencies.blocks.map((id) => (
                    <button
                      key={id}
                      className="text-left text-ink-dim hover:text-ink"
                      onClick={() => store.selectTask(id)}
                    >
                      blocks → {store.tasks.find((t) => t.id === id)?.title ?? id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {task.revisionOfTaskId && (
              <div>
                <div className="text-2xs uppercase tracking-wider text-ink-faint">Revision of</div>
                <button
                  className="mt-1 text-sm text-accent"
                  onClick={() => store.selectTask(task.revisionOfTaskId as string)}
                >
                  {store.tasks.find((t) => t.id === task.revisionOfTaskId)?.title ??
                    task.revisionOfTaskId}
                </button>
                {Array.isArray(task.context.requiredChanges) && (
                  <ul className="mt-1 list-disc pl-5 text-xs text-ink-dim">
                    {(task.context.requiredChanges as string[]).map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'runs' && (
          <div className="flex flex-col gap-2">
            {executions.length === 0 && <p className="text-xs text-ink-faint">No runs yet.</p>}
            {executions.map((execution) => (
              <Panel
                key={execution.id}
                title={
                  <span className="flex items-center gap-2">
                    <StatusDot status={execution.status} />
                    {execution.status} · {execution.model}
                    {execution.depth > 0 && (
                      <span className="mono text-2xs text-ink-faint">nested d{execution.depth}</span>
                    )}
                  </span>
                }
                actions={
                  <span className="mono text-2xs text-ink-faint">
                    {execution.iterations} turns · {execution.toolCallCount} tools ·{' '}
                    {formatCost(execution.costUsd / 1_000_000)}
                  </span>
                }
              >
                {execution.summary && (
                  <p className="whitespace-pre-wrap text-xs text-ink-dim">{execution.summary}</p>
                )}
                {execution.error && <p className="mt-1 text-xs text-bad">{execution.error}</p>}
                {execution.transcript?.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-2xs uppercase tracking-wider text-ink-faint">
                      Transcript · {execution.transcript.length} entries
                    </summary>
                    <div className="mt-1 max-h-64 scroll-y rounded border border-edge bg-base-900 p-2">
                      {execution.transcript.map((entry, i) => (
                        <div key={i} className="mono text-2xs leading-relaxed">
                          <span className="text-ink-faint">
                            {entry.kind === 'tool' ? '⚒' : '›'}{' '}
                          </span>
                          <span
                            className={entry.kind === 'tool' ? 'text-accent' : 'text-ink-dim'}
                          >
                            {entry.content}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Panel>
            ))}
          </div>
        )}

        {tab === 'verdicts' && (
          <div className="flex flex-col gap-2">
            {evaluations.length === 0 && (
              <p className="text-xs text-ink-faint">The Judge has not ruled on this task.</p>
            )}
            {evaluations.map((evaluation) => (
              <Panel
                key={evaluation.id}
                title={
                  <span className="flex items-center gap-2">
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
                    <ScoreBadge score={evaluation.score / 100} />
                  </span>
                }
                actions={
                  <span className="text-2xs text-ink-faint">
                    {formatRelative(evaluation.createdAt)}
                  </span>
                }
              >
                <p className="text-sm text-ink-dim">{evaluation.summary}</p>

                {evaluation.criteria.length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {evaluation.criteria.map((criterion) => (
                        <tr key={criterion.name}>
                          <td className="w-28 py-0.5 text-ink-faint">{criterion.name}</td>
                          <td className="w-10 py-0.5 mono tabular-nums">
                            {Math.round(criterion.score * 100)}%
                          </td>
                          <td className="py-0.5 text-ink-dim">{criterion.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {evaluation.issues.length > 0 && (
                  <div className="mt-2">
                    <div className="text-2xs uppercase tracking-wider text-ink-faint">Issues</div>
                    <ul className="list-disc pl-5 text-xs text-ink-dim">
                      {evaluation.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {evaluation.requiredChanges.length > 0 && (
                  <div className="mt-2">
                    <div className="text-2xs uppercase tracking-wider text-ink-faint">
                      Required changes
                    </div>
                    <ul className="list-disc pl-5 text-xs text-warn">
                      {evaluation.requiredChanges.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}

        {tab === 'artifacts' && (
          <div className="flex flex-col gap-2">
            {artifacts.length === 0 && <p className="text-xs text-ink-faint">No artifacts.</p>}
            {artifacts.map((artifact) => (
              <Panel
                key={artifact.id}
                title={
                  <span className="flex items-center gap-2">
                    <Badge>{artifact.kind}</Badge>
                    <span className="truncate">{artifact.title}</span>
                  </span>
                }
              >
                {artifact.path && (
                  <p className="mono text-2xs text-ink-faint">{artifact.path}</p>
                )}
                {artifact.content && (
                  <pre className="mt-1 max-h-56 scroll-y whitespace-pre-wrap rounded border border-edge bg-base-900 p-2 mono text-2xs text-ink-dim">
                    {artifact.content}
                  </pre>
                )}
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NewTaskModal({ open, onClose }: { open: boolean; onClose(): void }): React.JSX.Element {
  const store = useStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState('')
  const [criteria, setCriteria] = useState('')
  const [priority, setPriority] = useState(50)
  const [requiresJudge, setRequiresJudge] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!store.activeProjectId) return
    try {
      const task = await api.tasks.create({
        projectId: store.activeProjectId,
        title,
        description,
        agentId: agentId || null,
        priority,
        requiresJudge,
        acceptanceCriteria: criteria
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      })
      await store.refreshProject()
      store.selectTask(task.id)
      setTitle('')
      setDescription('')
      setCriteria('')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal open={open} title="New task" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea value={description} rows={5} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assign to">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Leave in the backlog</option>
              {store.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority" hint="0–100, higher runs first.">
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Acceptance criteria" hint="One per line. The Judge scores against these.">
          <textarea value={criteria} rows={4} onChange={(e) => setCriteria(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm normal-case tracking-normal text-ink-dim">
          <input
            type="checkbox"
            checked={requiresJudge}
            onChange={(e) => setRequiresJudge(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Require the Judge to approve the result
        </label>
        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!title.trim()} onClick={() => void submit()}>
            Create task
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function TasksEmpty(): React.JSX.Element {
  return <EmptyState title="No tasks" />
}
