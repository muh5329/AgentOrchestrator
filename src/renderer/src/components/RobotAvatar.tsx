import React, { useMemo } from 'react'
import clsx from 'clsx'
import { robotFace } from '../lib/robot'

/**
 * A pixel-art robot generated from an agent's id.
 *
 * Deliberately not an asset pack: agents are created at runtime, recursively and
 * without limit, so there is no fixed set to draw ahead of time. Every agent
 * gets a stable face derived from its own id, which means the same agent looks
 * the same on every machine and across restarts, and a new agent spawned by
 * another agent gets a face for free.
 *
 * The grid is mirrored down the centre line, the way identicons are, because
 * symmetry is what makes an arbitrary bit pattern read as a face.
 */

export function RobotAvatar({
  seed,
  size = 26,
  status,
  className
}: {
  seed: string
  size?: number
  /** Drives the ring only; the face itself never changes with state. */
  status?: string
  className?: string
}): React.JSX.Element {
  const face = useMemo(() => robotFace(seed), [seed])

  // A 12x12 viewBox: an 8x8 head with room for antenna, ears and a base.
  const unit = 1

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className={clsx('shrink-0', className)}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Agent avatar"
    >
      {/* Head plate */}
      <rect x="2" y="2.5" width="8" height="8" fill={face.glow} rx="0.6" />
      <rect x="2" y="2.5" width="8" height="7.4" fill={face.body} rx="0.6" />

      {/* Antenna */}
      {face.antenna && (
        <>
          <rect x="5.5" y="0.6" width="1" height="1.9" fill={face.glow} />
          <rect x="4.9" y="0" width="2.2" height="1.1" fill={face.visor} rx="0.5" />
        </>
      )}

      {/* Ears */}
      {face.ears && (
        <>
          <rect x="0.8" y="5" width="1.2" height="2.6" fill={face.glow} rx="0.4" />
          <rect x="10" y="5" width="1.2" height="2.6" fill={face.glow} rx="0.4" />
        </>
      )}

      {/* Pattern, punched into the plate so the face reads as machined metal */}
      <g opacity="0.5">
        {face.cells.map((row, y) =>
          row.map((on, x) =>
            on ? (
              <rect
                key={`${x}-${y}`}
                x={2 + x * unit}
                y={2.5 + y * unit}
                width={unit}
                height={unit}
                fill={face.glow}
              />
            ) : null
          )
        )}
      </g>

      {/* Visor and eyes - drawn last so the face always resolves */}
      <rect x="2.8" y="4.4" width="6.4" height="2.6" fill="#151210" rx="0.5" />
      <rect x="3.9" y="5.2" width="1.2" height="1.1" fill={face.visor} rx="0.3" />
      <rect x="6.9" y="5.2" width="1.2" height="1.1" fill={face.visor} rx="0.3" />

      {/* Mouth grille */}
      {face.mouth === 0 && <rect x="4.4" y="8" width="3.2" height="0.7" fill="#151210" rx="0.3" />}
      {face.mouth === 1 && (
        <>
          <rect x="4.4" y="8" width="0.8" height="0.7" fill="#151210" />
          <rect x="5.6" y="8" width="0.8" height="0.7" fill="#151210" />
          <rect x="6.8" y="8" width="0.8" height="0.7" fill="#151210" />
        </>
      )}
      {face.mouth === 2 && <rect x="4.8" y="8" width="2.4" height="1.1" fill="#151210" rx="0.5" />}

      {/* Running agents get a pulsing ring; everything else is still. */}
      {status === 'RUNNING' && (
        <rect
          x="1.4"
          y="1.4"
          width="9.2"
          height="9.7"
          fill="none"
          stroke={face.visor}
          strokeWidth="0.4"
          rx="1"
          className="avatar-pulse"
        />
      )}
    </svg>
  )
}
