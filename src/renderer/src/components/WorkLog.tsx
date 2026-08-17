import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { api } from '../api'
import { formatCost, formatClock, formatDuration, formatTokens, StatusDot } from '../ui'
import type { Execution } from '@shared/models'

type RunSummary = Omit<Execution, 'transcript'> & { transcriptLength: number }

/**
 * Why an agent succeeded or failed, in its own words and its own tool calls.
 *
 * "It failed" is the least useful thing an interface can say. Every run is
 * recorded with its transcript, its error and its accounting; this surfaces
 * them, newest first, with failures open by default - the one you want is
 * almost always the one that went wrong.
 */
export function WorkLog({ agentId }: { agentId: string }): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.executions
      .byAgent(agentId)
      .then((list) => {
        if (cancelled) return
        setRuns(list)
        // Open the most recent failure, or the most recent run if none failed.
        const firstBad = list.find((r) => r.status === 'FAILED' || r.error)
        setOpenId(firstBad?.id ?? list[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setRuns([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId])

  if (loading) return <p className="text-xs text-ink-faint">Loading…</p>
  if (!runs.length) {
    return <p className="text-xs text-ink-faint">This agent has not run yet.</p>
  }

  return (
    <div className="space-y-1.5">
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          open={openId === run.id}
          onToggle={() => setOpenId(openId === run.id ? null : run.id)}
        />
      ))}
    </div>
  )
}

function RunRow({
  run,
  open,
  onToggle
}: {
  run: RunSummary
  open: boolean
  onToggle(): void
}): React.JSX.Element {
  const [full, setFull] = useState<Execution | null>(null)
  const failed = run.status === 'FAILED' || Boolean(run.error)

  useEffect(() => {
    if (!open || full) return
    let cancelled = false
    api.executions
      .get(run.id)
      .then((value) => {
        if (!cancelled) setFull(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, run.id, full])

  return (
    <div
      className={clsx(
        'rounded-lg border bg-base-850',
        failed ? 'border-bad/40' : 'border-edge'
      )}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <span className="text-2xs text-ink-faint">{open ? '▾' : '▸'}</span>
        <StatusDot status={run.status} />
        <span className={clsx('text-xs', failed ? 'text-bad' : 'text-ink-dim')}>
          {run.status.toLowerCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-ink-faint">
          {run.error || run.summary || `${run.toolCallCount} tool calls`}
        </span>
        <span className="shrink-0 font-mono text-2xs text-ink-faint">
          {formatClock(run.startedAt)}
        </span>
      </button>

      {open && (
        <div className="border-t border-edge px-2.5 py-2">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-faint">
            <span>
              attempt <span className="tabular-nums text-ink-dim">{run.attempt + 1}</span>
            </span>
            <span>
              {run.provider} · {run.model}
            </span>
            <span>
              <span className="tabular-nums text-ink-dim">{run.iterations}</span> turns
            </span>
            <span>
              <span className="tabular-nums text-ink-dim">{run.toolCallCount}</span> tool calls
            </span>
            <span className="tabular-nums text-ink-dim">
              {formatTokens(run.inputTokens + run.outputTokens)}
            </span>
            <span className="tabular-nums text-ink-dim">{formatCost(run.costUsd / 1_000_000)}</span>
            {run.endedAt && (
              <span className="tabular-nums text-ink-dim">
                {formatDuration(run.endedAt - run.startedAt)}
              </span>
            )}
          </div>

          {run.error && (
            <div className="mb-2 rounded border border-bad/40 bg-bad/10 px-2 py-1.5">
              <div className="mb-0.5 text-2xs uppercase tracking-wider text-bad">Why it failed</div>
              <p className="whitespace-pre-wrap font-mono text-2xs leading-relaxed text-ink-dim">
                {run.error}
              </p>
            </div>
          )}

          {run.summary && !run.error && (
            <p className="mb-2 text-xs leading-relaxed text-ink-dim">{run.summary}</p>
          )}

          {!full ? (
            <p className="text-2xs text-ink-faint">Loading the transcript…</p>
          ) : full.transcript.length === 0 ? (
            <p className="text-2xs text-ink-faint">
              No transcript was recorded for this run.
            </p>
          ) : (
            <div className="scroll-y max-h-72 space-y-1 rounded border border-edge bg-base-900 p-2">
              {full.transcript.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <span
                    className={clsx(
                      'w-20 shrink-0 font-mono text-2xs uppercase',
                      entry.kind === 'error'
                        ? 'text-bad'
                        : entry.kind === 'tool'
                          ? 'text-accent'
                          : 'text-ink-faint'
                    )}
                  >
                    {entry.kind}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-ink-dim">
                    {entry.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
