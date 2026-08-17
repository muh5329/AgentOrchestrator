import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { RobotAvatar } from './RobotAvatar'
import { NewAgentModal } from './NewAgent'
import { BarList, VIZ } from './Charts'
import { formatCost, formatRelative, formatTokens, StatusDot } from '../ui'
import type { FleetAgent, FleetProject } from '@shared/models'

/**
 * Every agent in every project, grouped by project and nested by parentage, so
 * the recursion the application is built around is visible at rest rather than
 * only in the graph view.
 */
export function SessionsRail(): React.JSX.Element {
  const store = useStore()
  const [tab, setTab] = useState<'sessions' | 'usage'>('sessions')
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [hiring, setHiring] = useState(false)

  const query = filter.trim().toLowerCase()

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-850">
      <div className="flex items-center gap-3 border-b border-edge px-3 py-2">
        {(['sessions', 'usage'] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'text-sm capitalize transition-colors',
              tab === id ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
            )}
          >
            {id}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-2xs tabular-nums text-ink-faint">{store.fleet.agents.length}</span>
        <button
          className="text-sm text-ink-faint hover:text-accent disabled:opacity-30"
          disabled={!store.activeProjectId}
          onClick={() => setHiring(true)}
          title="New agent"
        >
          ＋
        </button>
      </div>

      {store.activeProjectId && (
        <NewAgentModal
          open={hiring}
          projectId={store.activeProjectId}
          onClose={() => setHiring(false)}
        />
      )}

      {tab === 'sessions' ? (
        <>
          <div className="px-2 py-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter agents…"
              className="h-7 w-full text-xs"
            />
          </div>

          <div className="scroll-y min-h-0 flex-1 pb-2">
            {store.fleet.projects.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-ink-faint">
                No projects yet. Create one and the Orchestrator staffs it.
              </p>
            )}

            {store.fleet.projects.map((project) => (
              <ProjectGroup
                key={project.id}
                project={project}
                agents={store.fleet.agents.filter((a) => a.projectId === project.id)}
                query={query}
                collapsed={collapsed[project.id] === true}
                onToggle={() =>
                  setCollapsed((prev) => ({ ...prev, [project.id]: !prev[project.id] }))
                }
              />
            ))}
          </div>
        </>
      ) : (
        <UsagePanel />
      )}
    </div>
  )
}

function ProjectGroup({
  project,
  agents,
  query,
  collapsed,
  onToggle
}: {
  project: FleetProject
  agents: FleetAgent[]
  query: string
  collapsed: boolean
  onToggle(): void
}): React.JSX.Element | null {
  const store = useStore()

  const matching = useMemo(
    () =>
      query
        ? agents.filter(
            (a) => a.name.toLowerCase().includes(query) || a.role.toLowerCase().includes(query)
          )
        : agents,
    [agents, query]
  )

  // Depth order: a child always renders under its parent. Computed before the
  // early return below, because a hook may not sit behind a conditional.
  const ordered = useMemo(() => orderByParentage(matching), [matching])

  // A filter that empties a group hides the group; an empty project still shows,
  // so you can see it exists and has no fleet yet.
  if (query && matching.length === 0) return null

  const isActive = store.activeProjectId === project.id

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="group flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
      >
        <span className="w-2 text-2xs text-ink-faint">{collapsed ? '▸' : '▾'}</span>
        <span
          className={clsx(
            'flex-1 truncate text-2xs uppercase tracking-wider',
            isActive ? 'text-ink-dim' : 'text-ink-faint'
          )}
        >
          {project.name}
        </span>
        <span className="text-2xs tabular-nums text-ink-faint">{project.agentCount}</span>
      </button>

      {!collapsed &&
        ordered.map((agent) => <AgentRow key={agent.id} agent={agent} project={project} />)}
    </div>
  )
}

/** Depth-first by parentage so children sit directly beneath their parent. */
function orderByParentage(agents: FleetAgent[]): FleetAgent[] {
  const byParent = new Map<string | null, FleetAgent[]>()
  const ids = new Set(agents.map((a) => a.id))

  for (const agent of agents) {
    // An agent whose parent is filtered out is treated as a root, so filtering
    // never hides a match behind a missing ancestor.
    const parent = agent.parentAgentId && ids.has(agent.parentAgentId) ? agent.parentAgentId : null
    const list = byParent.get(parent) ?? []
    list.push(agent)
    byParent.set(parent, list)
  }

  const out: FleetAgent[] = []
  const walk = (parent: string | null): void => {
    const children = (byParent.get(parent) ?? []).sort((a, b) => {
      if (a.role !== b.role) {
        const rank = (r: string): number => (r === 'orchestrator' ? 0 : r === 'judge' ? 1 : 2)
        return rank(a.role) - rank(b.role)
      }
      return a.createdAt - b.createdAt
    })
    for (const child of children) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(null)
  return out
}

function AgentRow({
  agent,
  project
}: {
  agent: FleetAgent
  project: FleetProject
}): React.JSX.Element {
  const store = useStore()
  const selected = store.selectedAgentId === agent.id

  const done = agent.totalTasks > 0 ? agent.completedTasks / agent.totalTasks : 0
  const barColor =
    agent.status === 'FAILED' || agent.status === 'BLOCKED'
      ? VIZ.bad
      : agent.runningTasks > 0
        ? VIZ.series
        : done === 1 && agent.totalTasks > 0
          ? VIZ.good
          : VIZ.muted

  const open = async (): Promise<void> => {
    if (store.activeProjectId !== project.id) await store.selectProject(project.id)
    store.selectAgent(agent.id)
    store.openTab({
      kind: 'agent',
      projectId: project.id,
      agentId: agent.id,
      title: agent.name
    })
  }

  return (
    <button
      onClick={() => void open()}
      className={clsx(
        'flex w-full items-start gap-2 px-2 py-1.5 text-left transition-colors',
        selected ? 'bg-base-750' : 'hover:bg-base-800'
      )}
      style={{ paddingLeft: 8 + Math.min(agent.depth, 4) * 12 }}
      title={agent.description || agent.name}
    >
      <RobotAvatar seed={agent.id} status={agent.status} size={26} className="mt-0.5" />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={clsx('truncate text-sm', selected ? 'text-ink' : 'text-ink-dim')}>
            {agent.name}
          </span>
          {agent.isBuiltIn && (
            <span className="shrink-0 rounded bg-base-700 px-1 text-2xs uppercase text-ink-faint">
              {agent.role}
            </span>
          )}
          <span className="flex-1" />
          {agent.costUsd > 0 && (
            <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
              {formatCost(agent.costUsd)}
            </span>
          )}
        </span>

        <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-ink-faint">
          <StatusDot status={agent.status} />
          <span className="capitalize">{agent.status.toLowerCase()}</span>
          {agent.branch && (
            <span className="truncate font-mono opacity-70" title={agent.branch}>
              ⑂ {agent.branch.replace(/^ao\//, '')}
            </span>
          )}
          {agent.openTasks > 0 && <span className="shrink-0">{agent.openTasks} open</span>}
          <span className="flex-1" />
          <span className="shrink-0">{formatRelative(agent.lastActiveAt)}</span>
        </span>

        <span className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-base-800">
          <span
            className="h-full rounded-full transition-all"
            style={{
              width: `${agent.totalTasks ? Math.max(4, done * 100) : 0}%`,
              background: barColor
            }}
          />
        </span>
      </span>
    </button>
  )
}

/**
 * What the fleet has actually cost, which is the question the sessions list
 * raises and cannot answer. Spend is per agent because that is the unit you can
 * act on - pause it, lower its model, cut its children.
 */
function UsagePanel(): React.JSX.Element {
  const store = useStore()

  const spenders = [...store.fleet.agents]
    .filter((a) => a.costUsd > 0 || a.tokens > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens)
    .slice(0, 14)

  const totalCost = store.fleet.agents.reduce((sum, a) => sum + a.costUsd, 0)
  const totalTokens = store.fleet.agents.reduce((sum, a) => sum + a.tokens, 0)

  return (
    <div className="scroll-y min-h-0 flex-1 space-y-4 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-edge bg-base-800 px-2.5 py-2">
          <div className="text-2xs uppercase tracking-wider text-ink-faint">Spend</div>
          <div className="text-base font-semibold tabular-nums text-ink">{formatCost(totalCost)}</div>
        </div>
        <div className="rounded border border-edge bg-base-800 px-2.5 py-2">
          <div className="text-2xs uppercase tracking-wider text-ink-faint">Tokens</div>
          <div className="text-base font-semibold tabular-nums text-ink">
            {formatTokens(totalTokens)}
          </div>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-2xs uppercase tracking-wider text-ink-faint">Spend by agent</h4>
        {spenders.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-faint">
            Nothing has been spent yet. The scripted provider is free, and the Claude Code CLI bills
            to your subscription rather than per token.
          </p>
        ) : (
          <BarList
            data={spenders.map((a) => ({
              label: a.name,
              value: a.costUsd,
              hint: `${formatTokens(a.tokens)} tokens`
            }))}
            format={formatCost}
          />
        )}
      </div>

      <div>
        <h4 className="mb-2 text-2xs uppercase tracking-wider text-ink-faint">Providers</h4>
        <div className="space-y-1">
          {store.providers.map((provider) => (
            <div key={provider.id} className="flex items-center gap-2 text-xs">
              <span
                className={clsx(
                  'h-1.5 w-1.5 rounded-full',
                  provider.availability?.available ? 'bg-good' : 'bg-ink-faint'
                )}
              />
              <span className="flex-1 truncate text-ink-dim">{provider.label}</span>
              <span
                className="text-2xs text-ink-faint"
                title={provider.availability?.detail ?? 'Not checked yet.'}
              >
                {provider.availability?.available ? 'ready' : 'unavailable'}
              </span>
            </div>
          ))}
        </div>
        <button
          className="mt-2 text-2xs text-accent hover:underline"
          onClick={() => void api.providers.check().then((list) => useStore.setState({ providers: list }))}
        >
          Re-check providers
        </button>
      </div>
    </div>
  )
}
