import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { RobotAvatar } from './RobotAvatar'
import type { Tool, Toolkit } from '@shared/models'
import { PERMISSIONS, type Permission } from '@shared/domain'

/**
 * What the selected agent can actually do, docked under the sessions rail.
 *
 * A tool is only reachable if the agent both holds the toolkit and holds the
 * permission the tool requires, so this shows the intersection rather than the
 * catalogue - the list here is the list the agent sees.
 */
export function ToolkitPanel(): React.JSX.Element {
  const store = useStore()
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(false)
  const [toolkits, setToolkits] = useState<Toolkit[]>([])
  const [tab, setTab] = useState<'tools' | 'permissions'>('tools')
  const [collapsed, setCollapsed] = useState(false)

  const agent = store.agents.find((a) => a.id === store.selectedAgentId) ?? null

  useEffect(() => {
    let cancelled = false
    if (!agent) {
      setTools([])
      return
    }
    setLoading(true)
    api.tools
      .forAgent(agent.id)
      .then((list) => {
        if (!cancelled) setTools(list)
      })
      .catch(() => {
        if (!cancelled) setTools([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agent?.id, store.agents])

  // Toolkit ids are opaque; the panel groups by the name a person recognises.
  useEffect(() => {
    let cancelled = false
    api.tools
      .toolkits(store.activeProjectId ?? undefined)
      .then((list) => {
        if (!cancelled) setToolkits(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [store.activeProjectId])

  const toolkitName = (id: string): string => toolkits.find((k) => k.id === id)?.name ?? 'Tools'

  const byToolkit = tools.reduce<Record<string, Tool[]>>((acc, tool) => {
    const key = tool.toolkitId ?? 'custom'
    acc[key] = acc[key] ?? []
    acc[key].push(tool)
    return acc
  }, {})

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-edge bg-base-850">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-2xs uppercase tracking-wider text-ink-faint">Toolkit</span>
        {agent && (
          <>
            <RobotAvatar seed={agent.id} size={16} />
            <span className="truncate text-xs text-ink-dim">{agent.name}</span>
          </>
        )}
        <span className="flex-1" />
        {agent && !collapsed && (
          <span className="text-2xs tabular-nums text-ink-faint">{tools.length}</span>
        )}
        <span className="text-2xs text-ink-faint">{collapsed ? '▴' : '▾'}</span>
      </button>

      {!collapsed && (
        <>
          {!agent ? (
            <p className="px-3 pb-3 text-xs text-ink-faint">
              Select an agent to see the tools and permissions it holds.
            </p>
          ) : (
            <>
              <div className="flex shrink-0 gap-3 border-b border-edge px-3 pb-1.5">
                {(['tools', 'permissions'] as const).map((id) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={clsx(
                      'text-xs capitalize transition-colors',
                      tab === id ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
                    )}
                  >
                    {id}
                    {id === 'permissions' && (
                      <span className="ml-1 tabular-nums text-ink-faint">
                        {agent.permissions.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="scroll-y min-h-0 flex-1 px-3 py-2">
                {tab === 'tools' ? (
                  loading ? (
                    <p className="text-xs text-ink-faint">Loading…</p>
                  ) : tools.length === 0 ? (
                    <p className="text-xs text-ink-faint">
                      No tools reachable. Give it a toolkit, or the permissions its toolkits require.
                    </p>
                  ) : (
                    Object.entries(byToolkit).map(([toolkitId, list]) => (
                      <div key={toolkitId} className="mb-2.5">
                        <div className="mb-1 text-2xs uppercase tracking-wider text-ink-faint">
                          {toolkitName(toolkitId)}
                        </div>
                        <div className="space-y-0.5">
                          {list.map((tool) => (
                            <div
                              key={tool.id}
                              className="flex items-baseline gap-1.5"
                              title={
                                tool.reachable === false
                                  ? `${tool.description}\n\nUnreachable: needs ${tool.requiredPermissions.join(', ')}`
                                  : tool.dangerous
                                    ? `${tool.description}\n\nStops for your approval before it runs.`
                                    : tool.description
                              }
                            >
                              <span
                                className={clsx(
                                  'h-1 w-1 shrink-0 rounded-full',
                                  tool.reachable === false
                                    ? 'bg-ink-faint/40'
                                    : tool.dangerous
                                      ? 'bg-warn'
                                      : 'bg-ink-faint'
                                )}
                              />
                              <span
                                className={clsx(
                                  'truncate font-mono text-xs',
                                  tool.reachable === false
                                    ? 'text-ink-faint/50 line-through'
                                    : 'text-ink-dim'
                                )}
                              >
                                {tool.name}
                              </span>
                              {tool.dangerous && tool.reachable !== false && (
                                <span className="shrink-0 text-2xs text-warn" title="Needs approval">
                                  ✋
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )
                ) : (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {PERMISSIONS.map((permission) => {
                      const held = agent.permissions.includes(permission as Permission)
                      return (
                        <span
                          key={permission}
                          className={clsx(
                            'truncate font-mono text-2xs',
                            held ? 'text-ink-dim' : 'text-ink-faint/40 line-through'
                          )}
                          title={held ? 'Granted' : 'Not granted'}
                        >
                          {permission.toLowerCase()}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
