import React, { useMemo } from 'react'
import clsx from 'clsx'

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

const GRID = 8
const HALF = GRID / 2

/** xmur3 - a small, fast, well-distributed string hash. */
function seedFrom(input: string): () => number {
  let h = 1779033703 ^ input.length
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  // mulberry32, seeded by the hash: deterministic and dependency-free.
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Hues are spread around the wheel rather than picked freely so two agents in
 * the same fleet rarely land on near-identical colours, and every result stays
 * bright enough to read on the dark surface.
 */
const HUES = [8, 32, 48, 96, 150, 175, 200, 224, 260, 288, 320, 340]

interface Face {
  body: string
  visor: string
  glow: string
  cells: boolean[][]
  antenna: boolean
  ears: boolean
  mouth: number
}

function buildFace(seed: string): Face {
  const rand = seedFrom(seed)
  const hue = HUES[Math.floor(rand() * HUES.length)]
  const sat = 55 + Math.floor(rand() * 25)

  const cells: boolean[][] = []
  for (let y = 0; y < GRID; y++) {
    const row: boolean[] = new Array(GRID).fill(false)
    for (let x = 0; x < HALF; x++) {
      // Denser towards the middle of the head so the silhouette stays solid.
      const on = rand() > (y < 2 || y > GRID - 3 ? 0.62 : 0.34)
      row[x] = on
      row[GRID - 1 - x] = on
    }
    cells.push(row)
  }

  return {
    body: `hsl(${hue} ${sat}% 62%)`,
    visor: `hsl(${hue} ${sat}% 82%)`,
    glow: `hsl(${hue} ${sat}% 46%)`,
    cells,
    antenna: rand() > 0.45,
    ears: rand() > 0.4,
    mouth: Math.floor(rand() * 3)
  }
}

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
  const face = useMemo(() => buildFace(seed), [seed])

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
      <rect x="2.8" y="4.4" width="6.4" height="2.6" fill="#0b0d10" rx="0.5" />
      <rect x="3.9" y="5.2" width="1.2" height="1.1" fill={face.visor} rx="0.3" />
      <rect x="6.9" y="5.2" width="1.2" height="1.1" fill={face.visor} rx="0.3" />

      {/* Mouth grille */}
      {face.mouth === 0 && <rect x="4.4" y="8" width="3.2" height="0.7" fill="#0b0d10" rx="0.3" />}
      {face.mouth === 1 && (
        <>
          <rect x="4.4" y="8" width="0.8" height="0.7" fill="#0b0d10" />
          <rect x="5.6" y="8" width="0.8" height="0.7" fill="#0b0d10" />
          <rect x="6.8" y="8" width="0.8" height="0.7" fill="#0b0d10" />
        </>
      )}
      {face.mouth === 2 && <rect x="4.8" y="8" width="2.4" height="1.1" fill="#0b0d10" rx="0.5" />}

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
