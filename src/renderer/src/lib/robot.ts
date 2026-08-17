/**
 * The shared identity of an agent's robot.
 *
 * Both the SVG avatar in the rails and the canvas sprite on the floor derive
 * from this, so an agent looks like itself wherever you meet it. Duplicating the
 * generator in two renderers would eventually let them drift, and an agent whose
 * face changes between panes is worse than no face at all.
 */

export const GRID = 8
const HALF = GRID / 2

/** xmur3 for the hash, mulberry32 for the stream: small, fast, no dependency. */
export function seedFrom(input: string): () => number {
  let h = 1779033703 ^ input.length
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
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
 * Hues are spread around the wheel rather than picked freely, so two agents in
 * the same fleet rarely land on near-identical colours and every result stays
 * bright enough to read on a dark surface.
 */
const HUES = [8, 32, 48, 96, 150, 175, 200, 224, 260, 288, 320, 340]

export interface RobotFace {
  hue: number
  body: string
  visor: string
  glow: string
  dark: string
  cells: boolean[][]
  antenna: boolean
  ears: boolean
  mouth: number
}

const cache = new Map<string, RobotFace>()

export function robotFace(seed: string): RobotFace {
  const hit = cache.get(seed)
  if (hit) return hit

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

  const face: RobotFace = {
    hue,
    body: `hsl(${hue} ${sat}% 62%)`,
    visor: `hsl(${hue} ${sat}% 82%)`,
    glow: `hsl(${hue} ${sat}% 46%)`,
    dark: `hsl(${hue} ${sat}% 30%)`,
    cells,
    antenna: rand() > 0.45,
    ears: rand() > 0.4,
    mouth: Math.floor(rand() * 3)
  }
  cache.set(seed, face)
  return face
}
