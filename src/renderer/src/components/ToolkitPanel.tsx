import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { RobotAvatar } from './RobotAvatar'
import { Button } from '../ui'
import type { Tool, Toolkit } from '@shared/models'
import { PERMISSIONS, type Permission } from '@shared/domain'

/**
 * The selected agent's toolkit, as a launcher rather than a list.
 *
 * These are the same tools the agent calls, and running one from here goes
 * through `ToolRuntime` as that agent - its permissions, the project's approval
 * policy, the same timeout and the same event trail. It is not a back door: if
 * the agent could not call it, neither can you on its behalf. That is what makes
 * a launcher honest rather than a second, weaker path into the system.
 */

/** A glyph per toolkit, so the grid is scannable before it is readable. */
const KIT_GLYPH: Record<string, string> = {
  Orchestration: '◈',
  Filesystem: '▤',
  Execution: '▶',
  Git: '⑂',
  Knowledge: '❖',
  Web: '◍',
  Judging: '⚖',
  Automation: '⟳',
  Inspection: '◎',
  Core: '●'
}

export function ToolkitPanel(): React.JSX.Element {
  const store = useStore()
  const [tools, setTools] = useState<Tool[]>([])
  const [toolkits, setToolkits] = useState<Toolkit[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'tools' | 'permissions'>('tools')
  const [collapsed, setCollapsed] = useState(false)
  const [running, setRunning] = useState<Tool | null>(null)

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

  const kitName = (id: string): string => toolkits.find((k) => k.id === id)?.name ?? 'Tools'

  // Reachable first: the panel is for acting, and an unreachable tool is not a
  // thing you can act on. They stay visible, greyed, so the gap is legible.
  const ordered = useMemo(
    () =>
      [...tools].sort((a, b) => {
        const reach = Number(b.reachable !== false) - Number(a.reachable !== false)
        if (reach) return reach
        const kit = kitName(a.toolkitId).localeCompare(kitName(b.toolkitId))
        return kit || a.name.localeCompare(b.name)
      }),
    [tools, toolkits]
  )

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-edge bg-base-850">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-accent">⚒</span>
        <span className="text-xs font-medium text-ink-dim">Toolkit</span>
        {agent && (
          <>
            <RobotAvatar seed={agent.id} size={16} />
            <span className="truncate text-xs text-ink-dim">{agent.name}</span>
          </>
        )}
        <span className="flex-1" />
        {agent && <span className="text-2xs tabular-nums text-ink-faint">{tools.length}</span>}
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

              <div className="scroll-y min-h-0 flex-1 p-2">
                {tab === 'tools' ? (
                  loading ? (
                    <p className="px-1 text-xs text-ink-faint">Loading…</p>
                  ) : tools.length === 0 ? (
                    <p className="px-1 text-xs text-ink-faint">
                      No tools reachable. Give it a toolkit, or the permissions its toolkits require.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {ordered.map((tool) => (
                        <ToolCard
                          key={tool.id}
                          tool={tool}
                          kit={kitName(tool.toolkitId)}
                          onRun={() => setRunning(tool)}
                        />
                      ))}
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 px-1">
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

      {running && agent && (
        <RunToolDialog tool={running} agentId={agent.id} onClose={() => setRunning(null)} />
      )}
    </div>
  )
}

function ToolCard({
  tool,
  kit,
  onRun
}: {
  tool: Tool
  kit: string
  onRun(): void
}): React.JSX.Element {
  const unreachable = tool.reachable === false

  return (
    <button
      onClick={unreachable ? undefined : onRun}
      disabled={unreachable}
      title={
        unreachable
          ? `${tool.description}\n\nUnreachable: needs ${tool.requiredPermissions.join(', ')}`
          : tool.dangerous
            ? `${tool.description}\n\nStops for your approval before it runs.`
            : tool.description
      }
      className={clsx(
        'group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors',
        unreachable
          ? 'cursor-not-allowed border-edge-soft bg-base-800/40 opacity-45'
          : 'border-edge bg-base-800 hover:border-edge-bright hover:bg-base-750'
      )}
    >
      <span
        className={clsx(
          'shrink-0 text-2xs',
          unreachable ? 'text-ink-faint' : 'text-accent group-hover:text-accent'
        )}
      >
        ▶
      </span>
      <span
        className={clsx(
          'min-w-0 flex-1 truncate font-mono text-2xs',
          unreachable ? 'text-ink-faint line-through' : 'text-ink-dim group-hover:text-ink'
        )}
      >
        {tool.name}
      </span>
      {tool.dangerous && !unreachable ? (
        <span className="shrink-0 text-2xs text-warn" title="Needs approval">
          ✋
        </span>
      ) : (
        <span className="shrink-0 text-2xs text-ink-faint/60" title={kit}>
          {KIT_GLYPH[kit] ?? '·'}
        </span>
      )}
    </button>
  )
}

/**
 * Fills in a tool's inputs and runs it.
 *
 * The form is generated from the tool's own JSON schema, which is the same
 * schema the model is handed and the same one `ToolRuntime` validates against -
 * so a form that passes here is a call the agent could have made.
 */
function RunToolDialog({
  tool,
  agentId,
  onClose
}: {
  tool: Tool
  agentId: string
  onClose(): void
}): React.JSX.Element {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; description?: string; default?: unknown }>
    required?: string[]
  }
  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(properties).map(([key, spec]) => [
        key,
        spec.default == null ? '' : String(spec.default)
      ])
    )
  )
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; content: string } | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      // Coerce by the schema's declared type; everything else goes as a string.
      const input: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(values)) {
        if (raw === '') continue
        const type = properties[key]?.type
        if (type === 'number' || type === 'integer') input[key] = Number(raw)
        else if (type === 'boolean') input[key] = raw === 'true'
        else if (type === 'array' || type === 'object') {
          try {
            input[key] = JSON.parse(raw)
          } catch {
            input[key] = raw
          }
        } else input[key] = raw
      }
      const outcome = await api.tools.run(agentId, tool.name, input)
      setResult({ ok: outcome.ok, content: outcome.content })
    } catch (err) {
      setResult({ ok: false, content: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-[520px] flex-col rounded-xl border border-edge bg-base-850 shadow-2xl">
        <header className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <span className="text-accent">▶</span>
          <span className="font-mono text-sm text-ink">{tool.name}</span>
          {tool.dangerous && (
            <span className="rounded bg-warn/15 px-1.5 py-0.5 text-2xs text-warn">
              needs approval
            </span>
          )}
          <span className="flex-1" />
          <button className="text-ink-faint hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="scroll-y min-h-0 flex-1 px-4 py-3">
          <p className="mb-3 text-xs leading-relaxed text-ink-dim">{tool.description}</p>

          {Object.keys(properties).length === 0 ? (
            <p className="text-xs text-ink-faint">This tool takes no input.</p>
          ) : (
            Object.entries(properties).map(([key, spec]) => (
              <label key={key} className="mb-3 block">
                <span className="mb-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-2xs normal-case tracking-normal text-ink-dim">
                    {key}
                  </span>
                  <span className="text-2xs text-ink-faint">{spec.type ?? 'string'}</span>
                  {required.includes(key) && <span className="text-2xs text-warn">required</span>}
                </span>
                {spec.description && (
                  <span className="mb-1 block text-2xs leading-relaxed text-ink-faint">
                    {spec.description}
                  </span>
                )}
                <textarea
                  rows={spec.type === 'string' && /content|body|text/.test(key) ? 4 : 1}
                  value={values[key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="w-full font-mono text-xs"
                />
              </label>
            ))
          )}

          {result && (
            <div
              className={clsx(
                'mt-3 rounded border px-2.5 py-2',
                result.ok ? 'border-good/40 bg-good/10' : 'border-bad/40 bg-bad/10'
              )}
            >
              <div className={clsx('mb-1 text-2xs uppercase tracking-wider', result.ok ? 'text-good' : 'text-bad')}>
                {result.ok ? 'ok' : 'failed'}
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-2xs text-ink-dim">
                {result.content}
              </pre>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-edge px-4 py-3">
          <span className="flex-1 text-2xs text-ink-faint">
            Runs as this agent, through the same permission gate.
          </span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" variant="primary" onClick={() => void run()} disabled={busy}>
            {busy ? 'Running…' : 'Run'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
