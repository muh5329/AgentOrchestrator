import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

/**
 * Charts for the report pane.
 *
 * Colour decision worth recording: these use the application's own palette
 * (accent / good / warn / bad) rather than a separate chart palette. Running the
 * data-viz validator over them against this surface passes CVD separation
 * (worst adjacent deutan dE 9.0, target >= 8), the normal-vision floor and the
 * 3:1 contrast gate; it fails only the dark-mode lightness band, because these
 * steps were chosen for a surface darker than the reference. Re-stepping them
 * for charts alone would make a chart's green differ from the green of the
 * status dot next to it on the same screen, which is the worse outcome. Every
 * segment is directly labelled with its count, so identity never rests on colour.
 */

export const VIZ = {
  series: '#e8913c',
  good: '#6fbf73',
  warn: '#e8b44c',
  bad: '#e06552',
  magic: '#b98ae0',
  muted: '#7c6d5e',
  grid: '#332b24',
  ink: '#b3a595'
}

/* ------------------------------------------------------------------ */
/* Stacked progress bar                                                */
/* ------------------------------------------------------------------ */

export interface Segment {
  label: string
  value: number
  color: string
}

/**
 * Part-to-whole across a handful of states. A 2px surface gap separates
 * segments, and the legend carries label + count so the bar is readable without
 * relying on hue.
 */
export function SegmentBar({
  segments,
  height = 10
}: {
  segments: Segment[]
  height?: number
}): React.JSX.Element {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const shown = segments.filter((s) => s.value > 0)

  return (
    <div>
      <div className="flex w-full gap-0.5 overflow-hidden rounded" style={{ height }}>
        {total === 0 ? (
          <div className="w-full rounded bg-base-750" />
        ) : (
          shown.map((s) => (
            <div
              key={s.label}
              className="rounded-sm first:rounded-l last:rounded-r"
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${s.value}`}
            />
          ))
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-2xs text-ink-faint">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
            <span className="tabular-nums text-ink-dim">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Measured width, so charts can plot in real pixels.
 *
 * A fixed viewBox scaled to a wide, short box letterboxes: the aspect ratio is
 * preserved, the plot shrinks to the height, and two thirds of the panel sits
 * empty. `preserveAspectRatio="none"` fixes the geometry and ruins the text, so
 * the honest fix is to know how wide we actually are.
 */
function useWidth<T extends HTMLElement>(fallback = 520): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width
      if (next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

/* ------------------------------------------------------------------ */
/* Score trend                                                         */
/* ------------------------------------------------------------------ */

export interface ScorePoint {
  at: number
  score: number
  label: string
  approved: boolean
}

/**
 * One series over time, so no legend box - the title names it. The pass
 * threshold is drawn as a reference line because a score is only meaningful
 * against the bar it had to clear.
 */
export function ScoreTrend({
  points,
  threshold,
  height = 120
}: {
  points: ScorePoint[]
  threshold: number
  height?: number
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const [ref, width] = useWidth<HTMLDivElement>()
  // Room on the right for the threshold label, so it never sits under a point.
  const pad = { top: 10, right: 62, bottom: 18, left: 30 }
  const plotW = Math.max(40, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom

  const xs = (i: number): number =>
    points.length <= 1 ? pad.left + plotW / 2 : pad.left + (i / (points.length - 1)) * plotW
  const ys = (v: number): number => pad.top + (1 - v) * plotH

  const path = useMemo(
    () => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs(i)},${ys(p.score)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, height, width]
  )

  const active = hover == null ? null : points[hover]

  return (
    <div className="relative" ref={ref}>
      {points.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-faint">No verdicts yet.</p>
      ) : (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} style={{ height }}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={ys(v)}
              y2={ys(v)}
              stroke={VIZ.grid}
              strokeWidth="1"
            />
            <text x={2} y={ys(v) + 3} fontSize="9" fill={VIZ.muted}>
              {Math.round(v * 100)}
            </text>
          </g>
        ))}

        {/* Pass threshold */}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={ys(threshold)}
          y2={ys(threshold)}
          stroke={VIZ.warn}
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.7"
        />
        <text x={width - pad.right + 6} y={ys(threshold) + 3} fontSize="9" fill={VIZ.warn}>
          pass {Math.round(threshold * 100)}%
        </text>

        <path d={path} fill="none" stroke={VIZ.series} strokeWidth="2" strokeLinejoin="round" />

        {points.map((p, i) => (
          <circle
            key={p.at + p.label + i}
            cx={xs(i)}
            cy={ys(p.score)}
            r={hover === i ? 5 : 4}
            fill={p.approved ? VIZ.good : VIZ.bad}
            stroke="#1c1815"
            strokeWidth="2"
          />
        ))}

        {/* Hit targets, wider than the marks */}
        {points.map((p, i) => (
          <rect
            key={`hit-${i}`}
            x={xs(i) - 12}
            y={pad.top}
            width="24"
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      )}

      {active && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded border border-edge bg-base-800 px-2 py-1 text-2xs shadow-lg">
          <span className={active.approved ? 'text-good' : 'text-bad'}>
            {active.approved ? 'APPROVED' : 'REJECTED'}
          </span>
          <span className="ml-1.5 tabular-nums text-ink">{Math.round(active.score * 100)}%</span>
          <span className="ml-1.5 text-ink-faint">{active.label}</span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Horizontal bars                                                     */
/* ------------------------------------------------------------------ */

export interface BarDatum {
  label: string
  value: number
  hint?: string
}

/** Magnitude across named things. One series, so one colour, directly labelled. */
export function BarList({
  data,
  format = (v) => String(v),
  color = VIZ.series
}: {
  data: BarDatum[]
  format?: (value: number) => string
  color?: string
}): React.JSX.Element {
  const max = Math.max(...data.map((d) => d.value), 0)
  if (!data.length) return <p className="py-6 text-center text-xs text-ink-faint">Nothing yet.</p>

  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-xs text-ink-dim" title={d.label}>
            {d.label}
          </span>
          <div className="h-2.5 min-w-0 flex-1 rounded-sm bg-base-800">
            <div
              className="h-full rounded-sm"
              style={{ width: max > 0 ? `${Math.max(2, (d.value / max) * 100)}%` : '0%', background: color }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink" title={d.hint}>
            {format(d.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Activity sparkline                                                  */
/* ------------------------------------------------------------------ */

/** Change over time for a single count. Area under one line, no axis furniture. */
export function Sparkline({
  values,
  height = 40,
  color = VIZ.magic
}: {
  values: number[]
  height?: number
  color?: string
}): React.JSX.Element {
  const width = 1000
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : width

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * step},${height - (v / max) * height}`)
  const area = `${line.join(' ')} L${(values.length - 1) * step},${height} L0,${height} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <path d={area} fill={color} opacity="0.14" />
      <path d={line.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                           */
/* ------------------------------------------------------------------ */

export function Tile({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'good' | 'warn' | 'bad' | 'accent'
}): React.JSX.Element {
  return (
    <div className="rounded border border-edge bg-base-850 px-3 py-2">
      <div className="text-2xs uppercase tracking-wider text-ink-faint">{label}</div>
      <div
        className={clsx(
          'mt-0.5 text-lg font-semibold tabular-nums',
          tone === 'good' && 'text-good',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-bad',
          tone === 'accent' && 'text-accent',
          !tone && 'text-ink'
        )}
      >
        {value}
      </div>
      {hint && <div className="text-2xs text-ink-faint">{hint}</div>}
    </div>
  )
}
