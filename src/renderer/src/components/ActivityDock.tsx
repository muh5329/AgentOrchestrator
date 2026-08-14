import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Badge, Button, Tabs, formatClock, formatRelative } from '../ui'
import type { AppEventRecord } from '@shared/models'

const LEVEL_COLOR: Record<string, string> = {
  debug: 'text-ink-faint',
  info: 'text-ink-dim',
  warn: 'text-warn',
  error: 'text-bad'
}

const TYPE_TONE: Record<string, string> = {
  JUDGE_APPROVED: 'text-good',
  JUDGE_REJECTED: 'text-warn',
  JUDGE_ESCALATED: 'text-magic',
  AGENT_SPAWNED: 'text-accent',
  APPROVAL_REQUESTED: 'text-warn',
  WATCHDOG_ALERT: 'text-warn',
  TASK_COMPLETED: 'text-good',
  TASK_FAILED: 'text-bad',
  EXECUTION_FAILED: 'text-bad',
  TOOL_DENIED: 'text-bad',
  BUDGET_EXCEEDED: 'text-bad'
}

/** The bottom dock: live timeline, inter-agent messages, and human approvals. */
export function ActivityDock(): React.JSX.Element {
  const store = useStore()
  const [filter, setFilter] = useState('')
  const [showDebug, setShowDebug] = useState(false)

  const events = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return store.events.filter((e) => {
      if (!showDebug && e.level === 'debug') return false
      if (!needle) return true
      return `${e.type} ${e.message}`.toLowerCase().includes(needle)
    })
  }, [store.events, filter, showDebug])

  return (
    <section
      className={clsx(
        'flex shrink-0 flex-col border-t border-edge bg-base-850 transition-all',
        store.dockOpen ? 'h-64' : 'h-9'
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 px-2">
        <Tabs
          active={store.dockTab}
          onChange={(tab) => store.setDock(true, tab)}
          tabs={[
            { id: 'activity', label: 'Activity' },
            { id: 'messages', label: `Messages${store.messages.length ? ` ${store.messages.length}` : ''}` },
            {
              id: 'approvals',
              label: (
                <span className={store.approvals.length ? 'text-warn' : undefined}>
                  Approvals{store.approvals.length ? ` ${store.approvals.length}` : ''}
                </span>
              )
            }
          ]}
        />
        <div className="flex-1" />
        {store.dockOpen && store.dockTab === 'activity' && (
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="h-6 w-48 text-xs"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDebug((v) => !v)}
              title="Include tool-level detail"
            >
              {showDebug ? 'Hide detail' : 'Show detail'}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => store.setDock(!store.dockOpen)}>
          {store.dockOpen ? '▾' : '▴'}
        </Button>
      </header>

      {store.dockOpen && (
        <div className="min-h-0 flex-1 border-t border-edge">
          {store.dockTab === 'activity' && <Timeline events={events} />}
          {store.dockTab === 'messages' && <Messages />}
          {store.dockTab === 'approvals' && <Approvals />}
        </div>
      )}
    </section>
  )
}

function Timeline({ events }: { events: AppEventRecord[] }): React.JSX.Element {
  const store = useStore()
  const agentName = (id: string | null): string =>
    id ? (store.agents.find((a) => a.id === id)?.name ?? '') : ''

  if (!events.length) {
    return <p className="p-4 text-xs text-ink-faint">Nothing yet.</p>
  }

  return (
    <div className="scroll-y h-full">
      <table className="w-full">
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="row-hover align-top">
              <td className="w-16 py-1 pl-3 pr-2 mono text-2xs text-ink-faint tabular-nums">
                {formatClock(event.createdAt)}
              </td>
              <td className="w-48 py-1 pr-2 mono text-2xs">
                <span className={TYPE_TONE[event.type] ?? 'text-ink-faint'}>{event.type}</span>
              </td>
              <td className="w-32 truncate py-1 pr-2 text-2xs text-ink-faint">
                {agentName(event.agentId)}
              </td>
              <td className={clsx('py-1 pr-3 text-xs', LEVEL_COLOR[event.level])}>
                {event.message}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Messages(): React.JSX.Element {
  const store = useStore()
  const name = (id: string | null): string =>
    id ? (store.agents.find((a) => a.id === id)?.name ?? 'unknown') : 'everyone'

  if (!store.messages.length) {
    return <p className="p-4 text-xs text-ink-faint">No messages between agents yet.</p>
  }

  return (
    <div className="scroll-y h-full p-2">
      {store.messages.map((message) => (
        <div key={message.id} className="flex gap-2 rounded px-2 py-1.5 row-hover">
          <span className="mono text-2xs text-ink-faint w-16 shrink-0 tabular-nums">
            {formatClock(message.createdAt)}
          </span>
          <Badge tone={message.type === 'HELP_REQUEST' ? 'warn' : 'neutral'}>{message.type}</Badge>
          <span className="text-xs text-ink-dim shrink-0">
            {name(message.fromAgentId)} → {name(message.toAgentId)}
          </span>
          <span className="text-xs text-ink whitespace-pre-wrap">{message.content}</span>
        </div>
      ))}
    </div>
  )
}

function Approvals(): React.JSX.Element {
  const store = useStore()

  if (!store.approvals.length) {
    return (
      <p className="p-4 text-xs text-ink-faint">
        Nothing is waiting on you. Agents escalate here when an action is irreversible, expensive,
        or outside their permissions.
      </p>
    )
  }

  return (
    <div className="scroll-y h-full p-2">
      {store.approvals.map((approval) => {
        const agent = store.agents.find((a) => a.id === approval.agentId)
        return (
          <div key={approval.id} className="panel mb-2 p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge tone="warn">Approval required</Badge>
                  <span className="text-xs text-ink-faint">{formatRelative(approval.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-md">{approval.action}</p>
                <p className="mt-0.5 text-sm text-ink-dim">{approval.reason}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  Requested by {agent?.name ?? 'the system'}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    void api.approvals.resolve(approval.id, true).then(() => store.refreshApprovals())
                  }
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    void api.approvals
                      .resolve(approval.id, false, 'Denied by the operator')
                      .then(() => store.refreshApprovals())
                  }
                >
                  Deny
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
