import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A draggable divider between panes.
 *
 * The pointer is captured on the divider itself, so a fast drag that outruns the
 * cursor does not drop the gesture over whatever it happens to be above - which
 * with an editor and a canvas in the neighbouring panes it very often is.
 */
export function Resizer({
  direction,
  onResize,
  min,
  max,
  value,
  invert = false
}: {
  direction: 'col' | 'row'
  value: number
  min: number
  max: number
  /** True when the pane being sized is below or to the right of the divider. */
  invert?: boolean
  onResize(next: number): void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ pointer: 0, value: 0 })

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const moved = (direction === 'col' ? e.clientX : e.clientY) - start.current.pointer
      const delta = invert ? -moved : moved
      onResize(Math.min(max, Math.max(min, start.current.value + delta)))
    },
    [direction, invert, max, min, onResize]
  )

  const onPointerUp = useCallback(() => setDragging(false), [])

  useEffect(() => {
    if (!dragging) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    // Stop the drag from selecting text in the panes either side of it.
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      document.body.style.userSelect = previous
    }
  }, [dragging, onPointerMove, onPointerUp])

  return (
    <div
      role="separator"
      aria-orientation={direction === 'col' ? 'vertical' : 'horizontal'}
      data-dragging={dragging}
      className={direction === 'col' ? 'col-resizer' : 'row-resizer'}
      onPointerDown={(e) => {
        start.current = { pointer: direction === 'col' ? e.clientX : e.clientY, value }
        setDragging(true)
      }}
    />
  )
}
