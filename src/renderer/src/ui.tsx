import React, { useEffect, useRef } from 'react'
import clsx from 'clsx'
import type { AgentStatus, TaskStatus } from '@shared/domain'

/* ----------------------------- formatting ------------------------------ */

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '—'
  const delta = Date.now() - ts
  if (delta < 0) return `in ${formatDuration(-delta)}`
  if (delta < 5000) return 'just now'
  return `${formatDuration(delta)} ago`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function formatCost(usd: number): string {
  if (!usd) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`
}

/* ------------------------------- status -------------------------------- */

export const AGENT_STATUS_COLOR: Record<AgentStatus, string> = {
  CREATED: 'text-ink-faint',
  IDLE: 'text-info',
  QUEUED: 'text-ink-dim',
  RUNNING: 'text-good',
  WAITING: 'text-warn',
  BLOCKED: 'text-warn',
  REVIEW: 'text-magic',
  FAILED: 'text-bad',
  COMPLETED: 'text-good',
  PAUSED: 'text-ink-faint',
  DISABLED: 'text-ink-faint'
}

export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  BACKLOG: 'text-ink-faint',
  READY: 'text-info',
  QUEUED: 'text-ink-dim',
  RUNNING: 'text-good',
  WAITING: 'text-warn',
  BLOCKED: 'text-warn',
  REVIEW: 'text-magic',
  FAILED: 'text-bad',
  COMPLETED: 'text-good',
  CANCELLED: 'text-ink-faint'
}

export function StatusDot({
  status,
  className
}: {
  status: string
  className?: string
}): React.JSX.Element {
  const color =
    (AGENT_STATUS_COLOR as Record<string, string>)[status] ??
    (TASK_STATUS_COLOR as Record<string, string>)[status] ??
    'text-ink-faint'
  return (
    <span
      className={clsx(
        'inline-block h-1.5 w-1.5 rounded-full bg-current shrink-0',
        color,
        status === 'RUNNING' && 'running-pulse',
        className
      )}
      aria-hidden
    />
  )
}

export function StatusLabel({ status }: { status: string }): React.JSX.Element {
  const color =
    (AGENT_STATUS_COLOR as Record<string, string>)[status] ??
    (TASK_STATUS_COLOR as Record<string, string>)[status] ??
    'text-ink-faint'
  return (
    <span className={clsx('inline-flex items-center gap-1.5 mono text-xs', color)}>
      <StatusDot status={status} />
      {status}
    </span>
  )
}

/* ------------------------------ primitives ----------------------------- */

export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'magic'
  className?: string
}): React.JSX.Element {
  const tones: Record<string, string> = {
    neutral: 'bg-base-750 text-ink-dim border-edge',
    accent: 'bg-accent-soft/40 text-accent border-accent/40',
    good: 'bg-good/10 text-good border-good/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    bad: 'bg-bad/10 text-bad border-bad/30',
    magic: 'bg-magic/10 text-magic border-magic/30'
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs uppercase tracking-wide font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const variants: Record<string, string> = {
    default: 'bg-base-750 hover:bg-base-700 border-edge text-ink',
    primary: 'bg-accent hover:bg-accent/85 border-accent text-white',
    ghost: 'bg-transparent hover:bg-base-800 border-transparent text-ink-dim hover:text-ink',
    danger: 'bg-transparent hover:bg-bad/15 border-bad/40 text-bad'
  }
  return (
    <button
      {...props}
      className={clsx(
        'no-drag inline-flex items-center justify-center gap-1.5 rounded border font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm',
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  )
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  dense
}: {
  title?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  dense?: boolean
}): React.JSX.Element {
  return (
    <section className={clsx('panel flex flex-col min-h-0', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2 shrink-0">
          <h2 className="text-xs uppercase tracking-wider text-ink-dim font-medium">{title}</h2>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', dense ? '' : 'p-3', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'good' | 'warn' | 'bad'
}): React.JSX.Element {
  return (
    <div className="panel px-3 py-2.5">
      <div className="text-2xs uppercase tracking-wider text-ink-faint">{label}</div>
      <div
        className={clsx(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'good' && 'text-good',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-bad'
        )}
      >
        {value}
      </div>
      {hint != null && <div className="mt-0.5 text-xs text-ink-faint truncate">{hint}</div>}
    </div>
  )
}

export function Meter({
  value,
  tone = 'accent',
  className
}: {
  value: number
  tone?: 'accent' | 'good' | 'warn' | 'bad'
  className?: string
}): React.JSX.Element {
  const tones: Record<string, string> = {
    accent: 'bg-accent',
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad'
  }
  return (
    <div className={clsx('h-1 w-full rounded-full bg-base-700 overflow-hidden', className)}>
      <div
        className={clsx('h-full rounded-full transition-all duration-500', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label>{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}

export function EmptyState({
  title,
  detail,
  action
}: {
  title: string
  detail?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-md text-ink-dim">{title}</p>
      {detail && <p className="max-w-md text-sm text-ink-faint">{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-2xl'
}: {
  open: boolean
  title: React.ReactNode
  onClose(): void
  children: React.ReactNode
  width?: string
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={ref} className={clsx('panel w-full bg-base-850 shadow-2xl', width)}>
        <header className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="text-md font-medium">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="max-h-[70vh] scroll-y p-4">{children}</div>
      </div>
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  // T is inferred from `active`, so callers keep their literal union types.
  tabs: Array<{ id: NoInfer<T>; label: React.ReactNode }>
  active: T
  onChange(id: NoInfer<T>): void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            'rounded px-2 py-1 text-xs transition-colors',
            active === tab.id
              ? 'bg-base-700 text-ink'
              : 'text-ink-faint hover:text-ink-dim hover:bg-base-800'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-edge bg-base-800 px-1 py-0.5 font-mono text-2xs text-ink-faint">
      {children}
    </kbd>
  )
}

export function ScoreBadge({ score }: { score: number | null }): React.JSX.Element | null {
  if (score == null) return null
  const pct = Math.round(score * 100)
  return (
    <Badge tone={pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad'}>{pct}%</Badge>
  )
}
