import React, { useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Button, formatRelative } from '../ui'
import { RobotAvatar } from './RobotAvatar'

/**
 * The one thing in the window that is allowed to interrupt you.
 *
 * An agent blocked on approval is not making progress, and the cost of missing
 * it is unbounded, so it gets a permanent slot at the bottom of the rail rather
 * than a panel you have to remember to open.
 */
export function AttentionBar(): React.JSX.Element | null {
  const store = useStore()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const approvals = store.approvals
  if (approvals.length === 0) return null

  const resolve = async (id: string, approved: boolean): Promise<void> => {
    setBusy(id)
    try {
      await api.approvals.resolve(id, approved)
      await store.refreshApprovals()
    } catch (err) {
      useStore.setState({ error: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="shrink-0 border-t border-warn/40 bg-warn/10">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-warn">⚠</span>
        <span className="flex-1 truncate text-xs text-warn">
          {approvals.length === 1
            ? '1 agent is waiting on you'
            : `${approvals.length} agents are waiting on you`}
        </span>
        <span className="text-2xs text-warn/70">{expanded ? '▾' : '▴'}</span>
      </button>

      {expanded && (
        <div className="scroll-y max-h-64 border-t border-warn/20 px-2 pb-2">
          {approvals.map((approval) => (
            <div key={approval.id} className="mt-2 rounded border border-edge bg-base-850 p-2">
              <div className="flex items-center gap-1.5">
                {approval.agentId && <RobotAvatar seed={approval.agentId} size={16} />}
                <span className="truncate text-2xs text-ink-dim">
                  {store.agents.find((a) => a.id === approval.agentId)?.name ?? 'An agent'}
                </span>
                <span className="flex-1" />
                <span className="text-2xs text-ink-faint">{formatRelative(approval.createdAt)}</span>
              </div>

              <p className="mt-1 break-words font-mono text-2xs text-ink">{approval.action}</p>
              {approval.reason && (
                <p className="mt-1 text-2xs leading-relaxed text-ink-faint">{approval.reason}</p>
              )}

              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  className={clsx('flex-1', busy === approval.id && 'opacity-50')}
                  onClick={() => void resolve(approval.id, true)}
                  disabled={busy === approval.id}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="flex-1"
                  onClick={() => void resolve(approval.id, false)}
                  disabled={busy === approval.id}
                >
                  Deny
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
