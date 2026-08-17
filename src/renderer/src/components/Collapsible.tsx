import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

/**
 * A section that can be folded away, and that folds itself when its contents are
 * long enough to bury everything below them.
 *
 * A mission statement can be two lines or two pages. If it is two pages, the
 * sections under it are effectively invisible, and the person who wrote the long
 * mission is exactly the person who needs to see the rest of the report. So a
 * section that overflows collapses on first render and says how much is hidden,
 * rather than expecting the reader to scroll past it every time.
 */
export function Collapsible({
  title,
  aside,
  actions,
  children,
  /** Fold automatically when the content is taller than this, in pixels. */
  autoCollapseAbove = 260,
  defaultOpen = true
}: {
  title: string
  aside?: string
  actions?: React.ReactNode
  children: React.ReactNode
  autoCollapseAbove?: number
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [overflows, setOverflows] = useState(false)
  // A ref, not state: this must not re-render, and it must survive the
  // ResizeObserver firing again after the reader has already had a say.
  const measured = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = bodyRef.current
    if (!element) return

    const measure = (): void => {
      const tall = element.scrollHeight > autoCollapseAbove
      setOverflows(tall)
      // Only the first measurement may fold the section. After that the reader
      // has had a say, and re-measuring must never undo it.
      if (!measured.current) {
        measured.current = true
        if (tall) setOpen(false)
      }
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCollapseAbove])

  return (
    <section className="my-5">
      <div className="mb-2 flex items-baseline gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-baseline gap-1.5 text-2xs uppercase tracking-wider text-ink-faint hover:text-ink-dim"
        >
          <span className="w-2 text-center">{open ? '▾' : '▸'}</span>
          {title}
        </button>
        <span className="flex-1 border-b border-edge" />
        {actions}
        {aside && <span className="text-2xs text-ink-faint">{aside}</span>}
      </div>

      <div
        className={clsx(
          'relative overflow-hidden transition-all',
          open ? 'max-h-none' : 'max-h-0'
        )}
      >
        <div ref={bodyRef}>{children}</div>
      </div>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded border border-dashed border-edge py-1 text-2xs text-ink-faint hover:border-edge-bright hover:text-ink-dim"
        >
          {overflows ? 'Show the rest' : 'Expand'}
        </button>
      )}
    </section>
  )
}
