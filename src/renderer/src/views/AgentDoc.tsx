import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Markdown } from '../components/Markdown'
import { RobotAvatar } from '../components/RobotAvatar'
import { Button, formatCost, formatRelative, formatTokens, ScoreBadge, StatusDot } from '../ui'
import type { Task, Tool } from '@shared/models'

/**
 * One agent as a document: what it is for, how it was told to behave, what it
 * can reach, what it may do, and what it has actually done.
 *
 * Its brief and its dials sit on the same page because they are the same
 * decision - "what is this agent allowed to become" - and separating them is how
 * a fleet ends up with an agent whose instructions and whose limits disagree.
 */
export function AgentDoc({ agentId }: { agentId: string }): React.JSX.Element {
  const store = useStore()
  const agent = store.agents.find((a) => a.id === agentId) ?? null

  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [tools, setTools] = useState<Tool[]>([])
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    if (!agent) return
    setDescription(agent.description)
    setPrompt(agent.systemPrompt)
    setEditing(false)
  }, [agent?.id])

  useEffect(() => {
    let cancelled = false
    if (!agent) return
    void Promise.all([api.tools.forAgent(agent.id), api.tasks.byAgent(agent.id)])
      .then(([toolList, taskList]) => {
        if (cancelled) return
        setTools(toolList)
        setTasks(taskList)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [agent?.id, store.tasks])

  if (!agent) {
    return (
      <p className="p-6 text-sm text-ink-faint">
        That agent no longer exists. It may have been deleted by its parent.
      </p>
    )
  }

  const fleetAgent = store.fleet.agents.find((a) => a.id === agentId)
  const project = store.projects.find((p) => p.id === agent.projectId)
  const limits = project?.settings.limits
  const parent = store.agents.find((a) => a.id === agent.parentAgentId)
  const children = store.agents.filter((a) => a.parentAgentId === agent.id)
  const creator = store.agents.find((a) => a.id === agent.createdByAgentId)
  const reachable = tools.filter((t) => t.reachable !== false)

  const patch = async (values: Record<string, unknown>): Promise<void> => {
    try {
      await api.agents.update(agent.id, values)
      await store.refreshProject()
    } catch (err) {
      useStore.setState({ error: (err as Error).message })
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    await patch({ description, systemPrompt: prompt })
    setSaving(false)
    setEditing(false)
  }

  const busy = agent.status === 'RUNNING'

  return (
    <div className="scroll-y h-full min-h-0">
      <div className="mx-auto max-w-4xl px-8 py-6">
        {/* ---------------------------------------------------------- */}
        {/* Identity                                                    */}
        {/* ---------------------------------------------------------- */}
        <header className="flex items-start gap-4">
          <div className="rounded-xl border border-edge bg-base-850 p-2">
            <RobotAvatar seed={agent.id} size={64} status={agent.status} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-ink">{agent.name}</h1>
              <span className="rounded bg-base-750 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-ink-faint">
                {agent.role}
              </span>
              <StatusDot status={agent.status} />
              <span className="text-xs text-ink-faint">{agent.status.toLowerCase()}</span>
            </div>

            <p className="mt-1 font-mono text-2xs text-ink-faint">
              depth {agent.depth} · {agent.provider} · {agent.model}
              {fleetAgent?.branch ? ` · ⑂ ${fleetAgent.branch}` : ''} · last active{' '}
              {formatRelative(agent.lastActiveAt)}
            </p>

            {/* Actions you actually take on an agent, in reach of its name. */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip
                glyph={busy ? '❚❚' : '▶'}
                label={busy ? 'Pause' : agent.status === 'PAUSED' ? 'Resume' : 'Ready'}
                onClick={() =>
                  void api.agents
                    .setStatus(agent.id, busy || agent.status === 'IDLE' ? 'PAUSED' : 'IDLE')
                    .then(() => store.refreshProject())
                }
              />
              <Chip
                glyph="✎"
                label={editing ? 'Cancel edit' : 'Edit brief'}
                active={editing}
                onClick={() => setEditing(!editing)}
              />
              <Chip
                glyph="◈"
                label="Spawn child"
                onClick={() =>
                  void api.agents
                    .clone(agent.id, { name: `${agent.name} II`, parentAgentId: agent.id })
                    .then(() => store.refreshProject())
                }
              />
              <Chip
                glyph="⌗"
                label="Graph"
                onClick={() =>
                  store.openTab({
                    kind: 'view',
                    projectId: agent.projectId,
                    view: 'graph',
                    title: 'Graph'
                  })
                }
              />
              {editing && (
                <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save brief'}
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* ---------------------------------------------------------- */}
        {/* Dials and counters                                          */}
        {/* ---------------------------------------------------------- */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Card>
            <Dial
              label="Max children"
              hint="Fan-out limit for this agent. Blank follows the project."
              value={agent.maxChildren}
              fallback={limits?.maxChildrenPerAgent ?? 6}
              min={0}
              max={24}
              onChange={(next) => void patch({ maxChildren: next })}
            />
            <Dial
              label="Max depth"
              hint="How many generations may exist below it."
              value={agent.maxDepth}
              fallback={limits?.maxDepth ?? 4}
              min={0}
              max={8}
              onChange={(next) => void patch({ maxDepth: next })}
            />
          </Card>

          <Card>
            <Field label="Model">
              <input
                defaultValue={agent.model}
                onBlur={(e) => {
                  if (e.target.value !== agent.model) void patch({ model: e.target.value })
                }}
                className="h-7 w-full font-mono text-xs"
              />
            </Field>
            <Field label="Provider">
              <select
                value={agent.provider}
                onChange={(e) => void patch({ provider: e.target.value })}
                className="h-7 w-full py-0 text-xs"
              >
                {store.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                    {provider.availability?.available ? '' : ' (unavailable)'}
                  </option>
                ))}
              </select>
            </Field>
          </Card>

          <Card>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Counter label="Tasks" value={String(fleetAgent?.totalTasks ?? tasks.length)} />
              <Counter label="Open" value={String(fleetAgent?.openTasks ?? 0)} />
              <Counter
                label="Last score"
                value={
                  fleetAgent?.lastScore == null ? '—' : `${Math.round(fleetAgent.lastScore * 100)}%`
                }
              />
              <Counter
                label="Spend"
                value={formatCost(fleetAgent?.costUsd ?? 0)}
                hint={formatTokens(fleetAgent?.tokens ?? 0)}
              />
            </div>
          </Card>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Brief                                                       */}
        {/* ---------------------------------------------------------- */}
        <Section title="What it is for">
          {editing ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full font-mono text-xs"
              placeholder="What this agent owns, in a sentence or two. Markdown is fine."
            />
          ) : description.trim() ? (
            <Card>
              <Markdown>{description}</Markdown>
            </Card>
          ) : (
            <p className="text-xs text-ink-faint">No description. Press Edit brief to write one.</p>
          )}
        </Section>

        <Section title="Standing instructions" aside="the system prompt it runs under">
          <div className="flex gap-3">
            <div className="hidden w-24 shrink-0 rounded-xl border border-edge bg-base-850 p-3 text-center sm:block">
              <div className="text-2xl text-accent">⚡</div>
              <p className="mt-1 text-2xs leading-snug text-ink-faint">
                What this agent carries into every turn.
              </p>
            </div>
            <div className="min-w-0 flex-1">
              {editing ? (
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={14}
                  className="w-full font-mono text-xs"
                  placeholder="Standing instructions for this agent."
                />
              ) : prompt.trim() ? (
                <Card>
                  <Markdown>{prompt}</Markdown>
                </Card>
              ) : (
                <p className="text-xs text-ink-faint">No standing instructions.</p>
              )}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        {/* Reach                                                       */}
        {/* ---------------------------------------------------------- */}
        <Section
          title="Reach"
          aside={`${reachable.length} tools · ${agent.permissions.length} permissions`}
        >
          <div className="flex flex-wrap gap-1">
            {reachable.map((tool) => (
              <span
                key={tool.id}
                className={clsx(
                  'rounded-md border px-1.5 py-0.5 font-mono text-2xs',
                  tool.dangerous
                    ? 'border-warn/40 bg-warn/10 text-warn'
                    : 'border-edge bg-base-850 text-ink-dim'
                )}
                title={
                  tool.dangerous ? `${tool.description}\n\nStops for approval.` : tool.description
                }
              >
                {tool.name}
              </span>
            ))}
            {reachable.length === 0 && (
              <p className="text-xs text-ink-faint">
                No tools reachable — it holds no toolkit, or not the permissions its toolkits need.
              </p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.permissions.map((permission) => (
              <span
                key={permission}
                className="rounded bg-base-800 px-1.5 py-0.5 font-mono text-2xs text-ink-faint"
              >
                {permission.toLowerCase()}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Place in the fleet">
          <Card>
            <div className="space-y-2">
              <Relation label="Parent" agents={parent ? [parent] : []} empty="Top of the tree." />
              <Relation label="Children" agents={children} empty="None. It has not spawned anyone." />
              {creator && creator.id !== parent?.id && (
                <Relation label="Created by" agents={[creator]} empty="" />
              )}
            </div>
          </Card>
        </Section>

        <Section title="Work" aside={`${tasks.length} tasks`}>
          {tasks.length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing assigned yet.</p>
          ) : (
            <div className="space-y-1">
              {tasks
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((task) => (
                  <button
                    key={task.id}
                    onClick={() => {
                      store.selectTask(task.id)
                      store.openTab({
                        kind: 'view',
                        projectId: agent.projectId,
                        view: 'tasks',
                        title: 'Tasks'
                      })
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-edge bg-base-850 px-2.5 py-1.5 text-left hover:border-edge-bright"
                  >
                    <StatusDot status={task.status} />
                    <span className="truncate text-xs text-ink-dim">{task.title}</span>
                    <span className="flex-1" />
                    {task.score != null && <ScoreBadge score={task.score / 100} />}
                    <span className="w-14 shrink-0 text-right text-2xs text-ink-faint">
                      {formatRelative(task.updatedAt)}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Card({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-xl border border-edge bg-base-850 px-3.5 py-3">{children}</div>
  )
}

function Chip({
  glyph,
  label,
  active,
  onClick
}: {
  glyph: string
  label: string
  active?: boolean
  onClick(): void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors',
        active
          ? 'border-accent/50 bg-accent-soft text-accent'
          : 'border-edge bg-base-850 text-ink-dim hover:border-edge-bright hover:text-ink'
      )}
    >
      <span className="text-2xs text-accent">{glyph}</span>
      {label}
    </button>
  )
}

/**
 * A slider over a limit that may be unset.
 *
 * "Unset" is a real value here - it means "follow the project" - so it gets its
 * own control rather than being smuggled in as zero.
 */
function Dial({
  label,
  hint,
  value,
  fallback,
  min,
  max,
  onChange
}: {
  label: string
  hint: string
  value: number | null
  fallback: number
  min: number
  max: number
  onChange(next: number | null): void
}): React.JSX.Element {
  const effective = value ?? fallback

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xs uppercase tracking-wider text-ink-faint">{label}</span>
        <span className="flex-1" />
        <span className="font-mono text-xs tabular-nums text-ink">{effective}</span>
        {value == null && <span className="text-2xs text-ink-faint">project</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={effective}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full border-0 bg-base-700 p-0 accent-accent"
      />
      <div className="mt-1 flex items-baseline gap-2">
        <span className="flex-1 text-2xs leading-snug text-ink-faint">{hint}</span>
        {value != null && (
          <button className="shrink-0 text-2xs text-accent hover:underline" onClick={() => onChange(null)}>
            follow project
          </button>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <span className="mb-1 block text-2xs uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </div>
  )
}

function Counter({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="text-base font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="text-2xs text-ink-faint">{hint}</div>}
    </div>
  )
}

function Relation({
  label,
  agents,
  empty
}: {
  label: string
  agents: Array<{ id: string; name: string }>
  empty: string
}): React.JSX.Element | null {
  const store = useStore()
  if (!agents.length && !empty) return null

  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-2xs uppercase tracking-wider text-ink-faint">{label}</span>
      {agents.length === 0 ? (
        <span className="text-xs text-ink-faint">{empty}</span>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => {
                store.selectAgent(agent.id)
                store.openTab({
                  kind: 'agent',
                  projectId: store.activeProjectId ?? '',
                  agentId: agent.id,
                  title: agent.name
                })
              }}
              className="flex items-center gap-1.5 rounded-lg border border-edge bg-base-800 px-1.5 py-0.5 text-xs text-ink-dim hover:border-edge-bright"
            >
              <RobotAvatar seed={agent.id} size={14} />
              {agent.name}
            </button>
          ))}
        </span>
      )}
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
