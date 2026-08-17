import React, { useMemo } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { RobotAvatar } from './RobotAvatar'
import { formatClock } from '../ui'
import type { AppEventRecord } from '@shared/models'

/**
 * What actually changed, in the order it changed, grouped by day.
 *
 * Derived from the event log rather than kept as its own table, so it cannot
 * disagree with the rest of the application and nobody has to remember to write
 * an entry. The filter is the interesting part: a changelog that lists every
 * tool call is a transcript, not a changelog. These are the events that a person
 * returning after a week would want to read.
 */

const KINDS: Record<string, { label: string; tone: 'good' | 'bad' | 'warn' | 'plain' }> = {
  PROJECT_CREATED: { label: 'Project created', tone: 'plain' },
  PROJECT_COMPLETED: { label: 'Signed off', tone: 'good' },
  PROJECT_UPDATED: { label: 'Project edited', tone: 'plain' },
  AGENT_CREATED: { label: 'Agent joined', tone: 'plain' },
  AGENT_DELETED: { label: 'Agent removed', tone: 'warn' },
  TASK_COMPLETED: { label: 'Task done', tone: 'good' },
  TASK_FAILED: { label: 'Task failed', tone: 'bad' },
  TASK_BLOCKED: { label: 'Blocked', tone: 'warn' },
  JUDGE_APPROVED: { label: 'Approved', tone: 'good' },
  JUDGE_REJECTED: { label: 'Sent back', tone: 'bad' },
  JUDGE_ESCALATED: { label: 'Escalated', tone: 'warn' },
  APPROVAL_RESOLVED: { label: 'You decided', tone: 'plain' },
  GIT_ACTION: { label: 'Repository', tone: 'plain' },
  WORKFLOW_COMPLETED: { label: 'Workflow ran', tone: 'good' },
  WORKFLOW_FAILED: { label: 'Workflow failed', tone: 'bad' },
  BUDGET_EXCEEDED: { label: 'Out of budget', tone: 'bad' },
  WATCHDOG_ACTION: { label: 'Watchdog acted', tone: 'warn' }
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function Changelog({ limit = 60 }: { limit?: number }): React.JSX.Element {
  const store = useStore()

  const days = useMemo(() => {
    const entries = store.events.filter((event) => KINDS[event.type]).slice(0, limit)
    const grouped = new Map<string, AppEventRecord[]>()
    for (const entry of entries) {
      const key = dayKey(entry.createdAt)
      const list = grouped.get(key) ?? []
      list.push(entry)
      grouped.set(key, list)
    }
    return [...grouped.entries()]
  }, [store.events, limit])

  if (!days.length) {
    return (
      <p className="text-xs text-ink-faint">
        Nothing has changed yet. Entries appear here as work is finished, judged and merged.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {days.map(([day, entries]) => (
        <div key={day}>
          <div className="mb-1 text-2xs uppercase tracking-wider text-ink-faint">{day}</div>
          <div className="space-y-1">
            {entries.map((entry) => {
              const kind = KINDS[entry.type]
              const agent = store.agents.find((a) => a.id === entry.agentId)
              return (
                <div key={entry.id} className="flex items-baseline gap-2">
                  <span className="w-12 shrink-0 font-mono text-2xs text-ink-faint">
                    {formatClock(entry.createdAt)}
                  </span>
                  <span
                    className={clsx(
                      'w-24 shrink-0 truncate text-2xs',
                      kind.tone === 'good'
                        ? 'text-good'
                        : kind.tone === 'bad'
                          ? 'text-bad'
                          : kind.tone === 'warn'
                            ? 'text-warn'
                            : 'text-ink-faint'
                    )}
                  >
                    {kind.label}
                  </span>
                  {agent ? (
                    <RobotAvatar seed={agent.id} size={14} className="shrink-0 self-center" />
                  ) : (
                    <span className="w-[14px] shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 text-xs text-ink-dim">{entry.message}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
