import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Markdown } from '../components/Markdown'
import { RobotAvatar } from '../components/RobotAvatar'
import { Badge, Button, formatCost, formatRelative, formatTokens, ScoreBadge, StatusDot } from '../ui'
import type { Task, Tool } from '@shared/models'

/**
 * One agent as a document: what it is for, how it was told to behave, what it
 * can reach, and what it has actually done.
 *
 * The description and the system prompt are the agent's own text, so they are
 * rendered as markdown and editable in place - an agent's brief is the thing you
 * most often want to correct after watching it work, and making you go somewhere
 * else to do that is how briefs stay wrong.
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
  const parent = store.agents.find((a) => a.id === agent.parentAgentId)
  const children = store.agents.filter((a) => a.parentAgentId === agent.id)
  const creator = store.agents.find((a) => a.id === agent.createdByAgentId)
  const reachable = tools.filter((t) => t.reachable !== false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await api.agents.update(agent.id, { description, systemPrompt: prompt })
      await store.refreshProject()
      setEditing(false)
    } catch (err) {
      useStore.setState({ error: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="scroll-y h-full min-h-0">
      <div className="mx-auto max-w-4xl px-8 py-6">
        <header className="flex items-start gap-3">
          <RobotAvatar seed={agent.id} size={48} status={agent.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-ink">{agent.name}</h1>
              <Badge tone={agent.role === 'orchestrator' ? 'accent' : 'neutral'}>{agent.role}</Badge>
              <StatusDot status={agent.status} />
              <span className="text-xs text-ink-faint">{agent.status.toLowerCase()}</span>
            </div>
            <p className="mt-0.5 font-mono text-2xs text-ink-faint">
              depth {agent.depth} · {agent.provider} · {agent.model} · last active{' '}
              {formatRelative(agent.lastActiveAt)}
              {fleetAgent?.branch ? ` · ⑂ ${fleetAgent.branch}` : ''}
            </p>
          </div>
          <Button size="sm" variant={editing ? 'ghost' : 'default'} onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
          {editing && (
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
              Save
            </Button>
          )}
        </header>

        <div className="my-4 grid grid-cols-4 gap-2">
          <Metric label="Tasks" value={String(fleetAgent?.totalTasks ?? tasks.length)} />
          <Metric label="Open" value={String(fleetAgent?.openTasks ?? 0)} />
          <Metric
            label="Last score"
            value={
              fleetAgent?.lastScore == null ? '—' : `${Math.round(fleetAgent.lastScore * 100)}%`
            }
          />
          <Metric
            label="Spend"
            value={formatCost(fleetAgent?.costUsd ?? 0)}
            hint={formatTokens(fleetAgent?.tokens ?? 0)}
          />
        </div>

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
            <Markdown>{description}</Markdown>
          ) : (
            <p className="text-xs text-ink-faint">No description. Press Edit to write one.</p>
          )}
        </Section>

        <Section title="Skills" aside="the system prompt it runs under">
          {editing ? (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={16}
              className="w-full font-mono text-xs"
              placeholder="Standing instructions for this agent."
            />
          ) : prompt.trim() ? (
            <Markdown>{prompt}</Markdown>
          ) : (
            <p className="text-xs text-ink-faint">No standing instructions.</p>
          )}
        </Section>

        <Section title="Reach" aside={`${reachable.length} tools · ${agent.permissions.length} permissions`}>
          <div className="flex flex-wrap gap-1">
            {reachable.map((tool) => (
              <span
                key={tool.id}
                className={clsx(
                  'rounded border px-1.5 py-0.5 font-mono text-2xs',
                  tool.dangerous
                    ? 'border-warn/40 bg-warn/10 text-warn'
                    : 'border-edge bg-base-850 text-ink-dim'
                )}
                title={tool.dangerous ? `${tool.description}\n\nStops for approval.` : tool.description}
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
          <div className="space-y-1 text-sm">
            <Relation label="Parent" agents={parent ? [parent] : []} empty="Top of the tree." />
            <Relation
              label="Children"
              agents={children}
              empty="None. It has not spawned anyone."
            />
            {creator && creator.id !== parent?.id && (
              <Relation label="Created by" agents={[creator]} empty="" />
            )}
          </div>
        </Section>

        <Section title="Work" aside={`${tasks.length} tasks`}>
          {tasks.length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing assigned yet.</p>
          ) : (
            <div className="space-y-0.5">
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
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left row-hover"
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

function Metric({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="rounded border border-edge bg-base-850 px-3 py-2">
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
              className="flex items-center gap-1.5 rounded border border-edge bg-base-850 px-1.5 py-0.5 text-xs text-ink-dim hover:border-edge-bright"
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
