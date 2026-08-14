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
  StatusLabel,
  Tabs,
  formatRelative
} from '../ui'
import { PERMISSIONS, type Permission } from '@shared/domain'
import type { Agent, AppEventRecord, Task, Tool, Toolkit } from '@shared/models'

export function AgentsView(): React.JSX.Element {
  const store = useStore()
  const [creating, setCreating] = useState(false)
  const [parentForNew, setParentForNew] = useState<string | null>(null)

  const tree = useMemo(() => buildTree(store.agents), [store.agents])
  const selected = store.agents.find((a) => a.id === store.selectedAgentId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-edge">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="text-2xs uppercase tracking-wider text-ink-faint">
            Fleet · {store.agents.length}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setParentForNew(null)
              setCreating(true)
            }}
          >
            ＋
          </Button>
        </div>
        <div className="scroll-y flex-1 p-1">
          {tree.map((node) => (
            <button
              key={node.agent.id}
              onClick={() => store.selectAgent(node.agent.id)}
              className={clsx(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm row-hover',
                node.agent.id === store.selectedAgentId ? 'bg-base-750' : ''
              )}
              style={{ paddingLeft: 8 + node.depth * 14 }}
            >
              <StatusDot status={node.agent.status} />
              <span className="min-w-0 flex-1 truncate">{node.agent.name}</span>
              {node.agent.role !== 'worker' && (
                <span className="text-2xs text-ink-faint">{node.agent.role}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selected ? (
          <AgentInspector
            agent={selected}
            onSpawnChild={() => {
              setParentForNew(selected.id)
              setCreating(true)
            }}
          />
        ) : (
          <EmptyState
            title="Select an agent"
            detail="Agents are persistent workers. They hold a system prompt, a toolkit, permissions and a task history."
          />
        )}
      </div>

      <NewAgentModal
        open={creating}
        parentAgentId={parentForNew}
        onClose={() => setCreating(false)}
      />
    </div>
  )
}

interface TreeNode {
  agent: Agent
  depth: number
}

function buildTree(agents: Agent[]): TreeNode[] {
  const byParent = new Map<string | null, Agent[]>()
  for (const agent of agents) {
    const key = agent.parentAgentId
    byParent.set(key, [...(byParent.get(key) ?? []), agent])
  }
  const out: TreeNode[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const agent of (byParent.get(parentId) ?? []).sort((a, b) =>
      a.createdAt - b.createdAt
    )) {
      out.push({ agent, depth })
      walk(agent.id, depth + 1)
    }
  }
  walk(null, 0)
  // Anything whose parent has been removed still deserves to be listed.
  for (const agent of agents) {
    if (!out.some((n) => n.agent.id === agent.id)) out.push({ agent, depth: 0 })
  }
  return out
}

function AgentInspector({
  agent,
  onSpawnChild
}: {
  agent: Agent
  onSpawnChild(): void
}): React.JSX.Element {
  const store = useStore()
  const [tab, setTab] = useState<'overview' | 'prompt' | 'tools' | 'tasks' | 'log'>('overview')
  const [prompt, setPrompt] = useState(agent.systemPrompt)
  const [description, setDescription] = useState(agent.description)
  const [model, setModel] = useState(agent.model)
  const [dirty, setDirty] = useState(false)
  const [events, setEvents] = useState<AppEventRecord[]>([])
  const [toolkits, setToolkits] = useState<Toolkit[]>([])
  const [assigned, setAssigned] = useState<string[]>([])
  const [tools, setTools] = useState<Tool[]>([])

  useEffect(() => {
    setPrompt(agent.systemPrompt)
    setDescription(agent.description)
    setModel(agent.model)
    setDirty(false)
  }, [agent.id, agent.systemPrompt, agent.description, agent.model])

  useEffect(() => {
    if (tab === 'log') void api.events.forAgent(agent.id).then(setEvents)
    if (tab === 'tools') {
      void api.tools.toolkits(agent.projectId).then(setToolkits)
      void api.agents.toolkits(agent.id).then(setAssigned)
      void api.tools.forAgent(agent.id).then(setTools)
    }
  }, [tab, agent.id, agent.projectId])

  const tasks = store.tasks.filter((t) => t.agentId === agent.id)
  const children = store.agents.filter((a) => a.parentAgentId === agent.id)
  const parent = store.agents.find((a) => a.id === agent.parentAgentId) ?? null

  const save = async (): Promise<void> => {
    await api.agents.update(agent.id, { systemPrompt: prompt, description, model })
    setDirty(false)
    await store.refreshProject()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-edge px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-md font-semibold">{agent.name}</h1>
            <StatusLabel status={agent.status} />
            {agent.isBuiltIn && <Badge>built-in</Badge>}
            <Badge tone="accent">{agent.role}</Badge>
            <span className="mono text-2xs text-ink-faint">depth {agent.depth}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-faint">
            {agent.provider} · {agent.model} · last active {formatRelative(agent.lastActiveAt)}
          </p>
        </div>

        <div className="flex shrink-0 gap-1.5">
          {agent.status === 'PAUSED' ? (
            <Button size="sm" onClick={() => void api.agents.setStatus(agent.id, 'IDLE')}>
              Resume
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={agent.status === 'RUNNING'}
              onClick={() => void api.agents.setStatus(agent.id, 'PAUSED')}
            >
              Pause
            </Button>
          )}
          <Button size="sm" onClick={onSpawnChild}>
            Spawn child
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void api.agents.clone(agent.id).then(() => store.refreshProject())
            }
          >
            Clone
          </Button>
          {!agent.isBuiltIn && (
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await api.agents.remove(agent.id, true)
                store.selectAgent(null)
                await store.refreshProject()
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'prompt', label: 'Prompt' },
            { id: 'tools', label: 'Tools & permissions' },
            { id: 'tasks', label: `Tasks ${tasks.length}` },
            { id: 'log', label: 'Log' }
          ]}
        />
        <div className="flex-1" />
        {dirty && (
          <Button size="sm" variant="primary" onClick={() => void save()}>
            Save changes
          </Button>
        )}
      </div>

      <div className="scroll-y min-h-0 flex-1 p-3">
        {tab === 'overview' && (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Panel title="Description">
              <textarea
                value={description}
                rows={4}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setDirty(true)
                }}
                className="w-full"
              />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Model">
                  <input
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value)
                      setDirty(true)
                    }}
                  />
                </Field>
                <Field label="Provider">
                  <input value={agent.provider} disabled />
                </Field>
              </div>
            </Panel>

            <Panel title="Relationships">
              <div className="flex flex-col gap-2 text-sm">
                <div>
                  <span className="text-ink-faint">Parent: </span>
                  {parent ? (
                    <button className="text-accent" onClick={() => store.selectAgent(parent.id)}>
                      {parent.name}
                    </button>
                  ) : (
                    <span className="text-ink-dim">none (top level)</span>
                  )}
                </div>
                <div>
                  <span className="text-ink-faint">Children: </span>
                  {children.length === 0 ? (
                    <span className="text-ink-dim">none</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5 pt-1">
                      {children.map((child) => (
                        <button
                          key={child.id}
                          className="rounded border border-edge bg-base-800 px-1.5 py-0.5 text-xs row-hover"
                          onClick={() => store.selectAgent(child.id)}
                        >
                          {child.name}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                <div className="pt-2">
                  <div className="text-2xs uppercase tracking-wider text-ink-faint">Edges</div>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {store.graph.edges
                      .filter((e) => e.fromAgentId === agent.id || e.toAgentId === agent.id)
                      .map((edge) => {
                        const from = store.agents.find((a) => a.id === edge.fromAgentId)
                        const to = store.agents.find((a) => a.id === edge.toAgentId)
                        return (
                          <div key={edge.id} className="mono text-xs text-ink-dim">
                            {from?.name ?? '?'} <span className="text-ink-faint">{edge.kind}</span>{' '}
                            {to?.name ?? '?'}
                          </div>
                        )
                      })}
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {tab === 'prompt' && (
          <Panel title="System prompt" className="h-full" bodyClassName="flex flex-col">
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setDirty(true)
              }}
              className="mono min-h-[24rem] w-full flex-1 resize-none leading-relaxed"
            />
          </Panel>
        )}

        {tab === 'tools' && (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Panel title="Toolkits">
              <div className="flex flex-col gap-1.5">
                {toolkits.map((kit) => {
                  const on = assigned.includes(kit.id)
                  return (
                    <label
                      key={kit.id}
                      className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 normal-case tracking-normal row-hover"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        className="mt-1 h-3.5 w-3.5"
                        onChange={async (e) => {
                          const next = e.target.checked
                            ? [...assigned, kit.id]
                            : assigned.filter((id) => id !== kit.id)
                          setAssigned(next)
                          await api.agents.setToolkits(agent.id, next)
                          setTools(await api.tools.forAgent(agent.id))
                        }}
                      />
                      <span className="min-w-0">
                        <span className="text-sm text-ink">{kit.name}</span>
                        <span className="block text-xs text-ink-faint">{kit.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </Panel>

            <div className="flex flex-col gap-3">
              <Panel title="Permissions">
                <div className="flex flex-wrap gap-1.5">
                  {PERMISSIONS.map((permission) => {
                    const on = agent.permissions.includes(permission)
                    return (
                      <button
                        key={permission}
                        onClick={async () => {
                          if (on) await api.agents.revoke(agent.id, [permission as Permission])
                          else await api.agents.grant(agent.id, [permission as Permission])
                          await store.refreshProject()
                        }}
                        className={clsx(
                          'rounded border px-1.5 py-0.5 mono text-2xs transition-colors',
                          on
                            ? 'border-accent/40 bg-accent-soft/30 text-accent'
                            : 'border-edge bg-base-800 text-ink-faint hover:text-ink-dim'
                        )}
                      >
                        {permission}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-ink-faint">
                  Least privilege by default. An agent can only pass on permissions it holds
                  itself, and anything gated by project policy still asks you first.
                </p>
              </Panel>

              <Panel title={`Available tools · ${tools.length}`} dense>
                <div className="scroll-y max-h-64">
                  {tools.map((tool) => (
                    <div key={tool.id} className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="mono text-xs text-ink">{tool.name}</span>
                        {tool.requiredPermissions.map((p) => (
                          <span key={p} className="mono text-2xs text-ink-faint">
                            {p}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-ink-faint line-clamp-2">{tool.description}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {tab === 'tasks' && <AgentTasks tasks={tasks} />}

        {tab === 'log' && (
          <Panel title="Agent log" dense>
            <div className="scroll-y max-h-[70vh]">
              {events.length === 0 && <p className="p-3 text-xs text-ink-faint">No events.</p>}
              {events.map((event) => (
                <div key={event.id} className="flex gap-2 px-3 py-1 text-xs">
                  <span className="mono w-32 shrink-0 text-2xs text-ink-faint">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                  <span className="mono w-44 shrink-0 text-2xs text-ink-dim">{event.type}</span>
                  <span className="min-w-0 flex-1 text-ink-dim">{event.message}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

function AgentTasks({ tasks }: { tasks: Task[] }): React.JSX.Element {
  const store = useStore()
  if (!tasks.length) return <p className="text-xs text-ink-faint">No tasks assigned.</p>
  return (
    <Panel title="Tasks" dense>
      <div className="scroll-y max-h-[70vh]">
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => {
              store.selectTask(task.id)
              store.setView('tasks')
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left row-hover"
          >
            <StatusDot status={task.status} />
            <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
            <ScoreBadge score={task.score == null ? null : task.score / 100} />
            <span className="w-20 text-right text-2xs text-ink-faint">
              {formatRelative(task.updatedAt)}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

function NewAgentModal({
  open,
  parentAgentId,
  onClose
}: {
  open: boolean
  parentAgentId: string | null
  onClose(): void
}): React.JSX.Element {
  const store = useStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [permissions, setPermissions] = useState<Permission[]>(['FILES_READ', 'MEMORY_WRITE'])
  const [toolkitNames, setToolkitNames] = useState<string[]>(['Knowledge'])
  const [toolkits, setToolkits] = useState<Toolkit[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !store.activeProjectId) return
    setError(null)
    void api.tools.toolkits(store.activeProjectId).then(setToolkits)
  }, [open, store.activeProjectId])

  const parent = store.agents.find((a) => a.id === parentAgentId)

  const submit = async (): Promise<void> => {
    if (!store.activeProjectId) return
    try {
      const agent = await api.agents.create({
        projectId: store.activeProjectId,
        parentAgentId,
        name,
        description,
        systemPrompt,
        permissions,
        toolkitNames
      })
      await store.refreshProject()
      store.selectAgent(agent.id)
      setName('')
      setDescription('')
      setSystemPrompt('')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal
      open={open}
      title={parent ? `New agent under ${parent.name}` : 'New agent'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schema Designer" />
        </Field>
        <Field label="Description" hint="One sentence on what this agent is for.">
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field
          label="System prompt"
          hint="Its expertise, its boundaries, and what done means for it."
        >
          <textarea
            value={systemPrompt}
            rows={6}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="mono"
          />
        </Field>
        <Field label="Toolkits">
          <div className="flex flex-wrap gap-1.5">
            {toolkits.map((kit) => {
              const on = toolkitNames.includes(kit.name)
              return (
                <button
                  key={kit.id}
                  onClick={() =>
                    setToolkitNames((current) =>
                      on ? current.filter((n) => n !== kit.name) : [...current, kit.name]
                    )
                  }
                  className={clsx(
                    'rounded border px-2 py-0.5 text-xs',
                    on
                      ? 'border-accent/40 bg-accent-soft/30 text-accent'
                      : 'border-edge bg-base-800 text-ink-faint'
                  )}
                >
                  {kit.name}
                </button>
              )
            })}
          </div>
        </Field>
        <Field label="Permissions">
          <div className="flex flex-wrap gap-1.5">
            {PERMISSIONS.map((permission) => {
              const on = permissions.includes(permission)
              return (
                <button
                  key={permission}
                  onClick={() =>
                    setPermissions((current) =>
                      on
                        ? current.filter((p) => p !== permission)
                        : [...current, permission as Permission]
                    )
                  }
                  className={clsx(
                    'rounded border px-1.5 py-0.5 mono text-2xs',
                    on
                      ? 'border-accent/40 bg-accent-soft/30 text-accent'
                      : 'border-edge bg-base-800 text-ink-faint'
                  )}
                >
                  {permission}
                </button>
              )
            })}
          </div>
        </Field>

        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>
            Create agent
          </Button>
        </div>
      </div>
    </Modal>
  )
}
