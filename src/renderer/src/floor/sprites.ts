import { robotFace, type RobotFace } from '../lib/robot'
import type { Door, Prop } from './decor'

/**
 * Canvas drawing for the floor.
 *
 * Everything is drawn from primitives rather than loaded from an atlas: the
 * fleet is generated at runtime, so its art has to be too. Sizes are in world
 * units and the caller sets the transform, so one function serves every zoom.
 *
 * The scene is built in layers, back to front - shell, room floors, walls,
 * furniture, benches, robots, bubbles - because canvas has no z-index and the
 * paint order is the only thing keeping a robot in front of its own chair.
 */

/** The one place colours are named, so a reskin is a single edit. */
export const PALETTE = {
  shellOuter: '#0a0807',
  shellWall: '#3a3129',
  shellWallLit: '#544639',
  corridorA: '#2a231d',
  corridorB: '#261f1a',
  roomA: '#221c17',
  roomB: '#1e1813',
  roomEdge: '#4d4136',
  door: '#6b5744',
  label: '#c9bcae',
  labelDim: '#8a7a69',
  plate: '#12100d',
  desk: '#5b4a3b',
  deskEdge: '#3c3128',
  deskLeg: '#2b231c',
  chair: '#39302a',
  chairBack: '#4a3f36',
  monitor: '#241f1a',
  bezel: '#332b24',
  screen: '#0b0a09',
  screenOn: '#7fd07f',
  screenDim: '#2f4a34',
  keyboard: '#463a30',
  mug: '#c4674a',
  paper: '#cfc3ad',
  plantPot: '#7a4a35',
  leaf: '#4e8b52',
  leafDark: '#3a6b3e',
  metal: '#4a4038',
  metalLit: '#655648',
  glass: '#2b3f4a',
  sofa: '#3d4a55',
  sofaLit: '#4c5b68',
  crate: '#6b5136',
  binder: ['#8a5b3a', '#6b7f4a', '#4a6b8a', '#8a4a5b', '#7a6b3a'],
  accent: '#e8913c',
  good: '#6fbf73',
  warn: '#e8b44c',
  bad: '#e06552',
  muted: '#7c6d5e',
  bubble: '#241f1a',
  bubbleEdge: '#4d4136',
  bubbleInk: '#f0e9e1'
}

const C = PALETTE

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function tiles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  a: string,
  b: string,
  tile: number
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  for (let ty = 0; ty < h + tile; ty += tile) {
    for (let tx = 0; tx < w + tile; tx += tile) {
      const even = ((tx / tile) | 0) % 2 === ((ty / tile) | 0) % 2
      ctx.fillStyle = even ? a : b
      ctx.fillRect(x + tx, y + ty, tile, tile)
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/** The building: an outer wall, then the corridor floor everything sits on. */
export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number }
): void {
  ctx.save()
  ctx.fillStyle = C.shellOuter
  roundRect(ctx, bounds.x - 1.6, bounds.y - 1.6, bounds.w + 3.2, bounds.h + 3.2, 2)
  ctx.fill()

  ctx.strokeStyle = C.shellWall
  ctx.lineWidth = 1.6
  roundRect(ctx, bounds.x - 0.8, bounds.y - 0.8, bounds.w + 1.6, bounds.h + 1.6, 1.6)
  ctx.stroke()

  tiles(ctx, bounds.x, bounds.y, bounds.w, bounds.h, C.corridorA, C.corridorB, 4)

  // A lit top edge, so the shell reads as a wall with a light above it.
  ctx.strokeStyle = C.shellWallLit
  ctx.lineWidth = 0.3
  ctx.beginPath()
  ctx.moveTo(bounds.x, bounds.y + 0.15)
  ctx.lineTo(bounds.x + bounds.w, bounds.y + 0.15)
  ctx.stroke()
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

/**
 * A room: interior floor, then walls drawn as segments with a gap where the
 * door is, then a sign plate on the top wall.
 */
export function drawRoom(
  ctx: CanvasRenderingContext2D,
  room: { x: number; y: number; w: number; h: number; label: string },
  door: Door,
  highlighted: boolean
): void {
  ctx.save()

  tiles(ctx, room.x, room.y, room.w, room.h, C.roomA, C.roomB, 3)

  const gap = 4.5
  ctx.strokeStyle = highlighted ? C.accent : C.roomEdge
  ctx.lineWidth = highlighted ? 0.6 : 0.45
  ctx.lineCap = 'butt'

  const segs: Array<[number, number, number, number]> = []
  const push = (
    side: Door['side'],
    ax: number,
    ay: number,
    bx: number,
    by: number,
    horizontal: boolean
  ): void => {
    if (door.side !== side) {
      segs.push([ax, ay, bx, by])
      return
    }
    const length = horizontal ? bx - ax : by - ay
    const start = (horizontal ? ax : ay) + length * door.at - gap / 2
    if (horizontal) {
      segs.push([ax, ay, start, by])
      segs.push([start + gap, ay, bx, by])
    } else {
      segs.push([ax, ay, bx, start])
      segs.push([ax, start + gap, bx, by])
    }
  }

  push('top', room.x, room.y, room.x + room.w, room.y, true)
  push('bottom', room.x, room.y + room.h, room.x + room.w, room.y + room.h, true)
  push('left', room.x, room.y, room.x, room.y + room.h, false)
  push('right', room.x + room.w, room.y, room.x + room.w, room.y + room.h, false)

  ctx.beginPath()
  for (const [ax, ay, bx, by] of segs) {
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
  }
  ctx.stroke()

  // Threshold, so the gap reads as a doorway rather than a hole in the wall.
  ctx.strokeStyle = C.door
  ctx.lineWidth = 0.35
  ctx.beginPath()
  if (door.side === 'top' || door.side === 'bottom') {
    const y = door.side === 'top' ? room.y : room.y + room.h
    const start = room.x + room.w * door.at - gap / 2
    ctx.moveTo(start, y)
    ctx.lineTo(start + gap, y)
  } else {
    const x = door.side === 'left' ? room.x : room.x + room.w
    const start = room.y + room.h * door.at - gap / 2
    ctx.moveTo(x, start)
    ctx.lineTo(x, start + gap)
  }
  ctx.stroke()

  // Sign plate on the top wall.
  const text = room.label.toUpperCase()
  ctx.font = '600 1.4px ui-sans-serif, system-ui, sans-serif'
  const width = ctx.measureText(text).width + 2.4
  ctx.fillStyle = C.plate
  roundRect(ctx, room.x + room.w / 2 - width / 2, room.y - 1.2, width, 2.4, 0.6)
  ctx.fill()
  ctx.strokeStyle = highlighted ? C.accent : C.roomEdge
  ctx.lineWidth = 0.2
  ctx.stroke()
  ctx.fillStyle = highlighted ? C.accent : C.label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, room.x + room.w / 2, room.y)

  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Furniture                                                           */
/* ------------------------------------------------------------------ */

export function drawProp(ctx: CanvasRenderingContext2D, ox: number, oy: number, prop: Prop): void {
  const x = ox + prop.x
  const y = oy + prop.y
  ctx.save()

  switch (prop.kind) {
    case 'plant': {
      const s = prop.size ?? 1
      ctx.fillStyle = C.plantPot
      roundRect(ctx, x - 0.9 * s, y + 0.6 * s, 1.8 * s, 1.5 * s, 0.3 * s)
      ctx.fill()
      ctx.fillStyle = C.leafDark
      ctx.beginPath()
      ctx.ellipse(x, y - 0.1 * s, 1.5 * s, 1.2 * s, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = C.leaf
      ctx.beginPath()
      ctx.ellipse(x - 0.35 * s, y - 0.5 * s, 1 * s, 0.8 * s, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'whiteboard': {
      ctx.fillStyle = '#d9d3c4'
      roundRect(ctx, x, y, prop.w, 3.2, 0.2)
      ctx.fill()
      ctx.strokeStyle = C.metal
      ctx.lineWidth = 0.25
      ctx.stroke()
      // Fixed scribbles: a board that re-randomises every frame flickers.
      ctx.strokeStyle = '#7f8b9c'
      ctx.lineWidth = 0.18
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const ly = y + 0.7 + i * 0.62
        ctx.moveTo(x + 0.6, ly)
        ctx.lineTo(x + 1.4 + ((i * 37) % Math.max(2, Math.floor(prop.w - 2))), ly)
      }
      ctx.stroke()
      break
    }
    case 'cabinet': {
      const w = prop.w ?? 4
      ctx.fillStyle = C.metal
      roundRect(ctx, x, y, w, 2.6, 0.3)
      ctx.fill()
      ctx.fillStyle = C.metalLit
      roundRect(ctx, x + 0.25, y + 0.25, w - 0.5, 0.9, 0.2)
      ctx.fill()
      roundRect(ctx, x + 0.25, y + 1.4, w - 0.5, 0.9, 0.2)
      ctx.fill()
      break
    }
    case 'shelf': {
      ctx.fillStyle = C.metal
      roundRect(ctx, x, y, prop.w, prop.h, 0.2)
      ctx.fill()
      const slots = Math.floor(prop.w / 0.9)
      for (let i = 0; i < slots; i++) {
        ctx.fillStyle = C.binder[i % C.binder.length]
        const h = prop.h - 0.8 - ((i * 13) % 5) * 0.12
        ctx.fillRect(x + 0.4 + i * 0.9, y + prop.h - 0.4 - h, 0.62, h)
      }
      break
    }
    case 'crate': {
      ctx.fillStyle = C.crate
      roundRect(ctx, x, y, 3.4, 2.6, 0.25)
      ctx.fill()
      ctx.strokeStyle = '#4a3625'
      ctx.lineWidth = 0.22
      ctx.beginPath()
      ctx.moveTo(x, y + 1.3)
      ctx.lineTo(x + 3.4, y + 1.3)
      ctx.stroke()
      break
    }
    case 'sofa': {
      ctx.fillStyle = C.sofa
      roundRect(ctx, x, y, prop.w, 3.2, 0.7)
      ctx.fill()
      ctx.fillStyle = C.sofaLit
      roundRect(ctx, x + 0.5, y + 1.1, prop.w - 1, 1.7, 0.5)
      ctx.fill()
      ctx.fillStyle = C.sofa
      roundRect(ctx, x - 0.4, y + 0.6, 1, 2.4, 0.4)
      ctx.fill()
      roundRect(ctx, x + prop.w - 0.6, y + 0.6, 1, 2.4, 0.4)
      ctx.fill()
      break
    }
    case 'vending': {
      ctx.fillStyle = C.metal
      roundRect(ctx, x, y, 3.2, 5.4, 0.4)
      ctx.fill()
      ctx.fillStyle = C.glass
      roundRect(ctx, x + 0.4, y + 0.5, 2.1, 3.9, 0.25)
      ctx.fill()
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = C.binder[i % C.binder.length]
        ctx.fillRect(x + 0.7, y + 0.9 + i * 1.15, 1.5, 0.55)
      }
      ctx.fillStyle = C.metalLit
      roundRect(ctx, x + 2.65, y + 1, 0.35, 2.4, 0.15)
      ctx.fill()
      break
    }
    case 'cooler': {
      ctx.fillStyle = C.glass
      roundRect(ctx, x, y, 1.6, 2.2, 0.4)
      ctx.fill()
      ctx.fillStyle = C.metal
      roundRect(ctx, x - 0.15, y + 2.1, 1.9, 2.6, 0.3)
      ctx.fill()
      break
    }
    case 'table': {
      ctx.fillStyle = C.deskEdge
      ctx.beginPath()
      ctx.arc(x, y, prop.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = C.desk
      ctx.beginPath()
      ctx.arc(x, y - 0.2, prop.r - 0.25, 0, Math.PI * 2)
      ctx.fill()
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.6
        ctx.fillStyle = C.mug
        ctx.beginPath()
        ctx.arc(
          x + Math.cos(a) * (prop.r - 0.9),
          y + Math.sin(a) * (prop.r - 0.9) - 0.2,
          0.32,
          0,
          Math.PI * 2
        )
        ctx.fill()
      }
      break
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Desks                                                               */
/* ------------------------------------------------------------------ */

/**
 * A shared bench with a workstation per seat.
 *
 * One slab rather than separate tables, because that is what an open-plan floor
 * looks like and because a continuous surface gives the props somewhere to sit
 * between monitors.
 */
export function drawBench(
  ctx: CanvasRenderingContext2D,
  seats: Array<{ x: number; y: number }>,
  litSeats: boolean[],
  phase: number
): void {
  if (!seats.length) return
  const y = seats[0].y
  const left = seats[0].x - 3.6
  const right = seats[seats.length - 1].x + 3.6

  ctx.save()

  ctx.fillStyle = C.deskLeg
  ctx.fillRect(left + 0.6, y + 1.4, 0.7, 1.4)
  ctx.fillRect(right - 1.3, y + 1.4, 0.7, 1.4)

  ctx.fillStyle = C.deskEdge
  roundRect(ctx, left, y - 2.6, right - left, 4.2, 0.5)
  ctx.fill()
  ctx.fillStyle = C.desk
  roundRect(ctx, left, y - 2.6, right - left, 3.4, 0.5)
  ctx.fill()

  seats.forEach((seat, i) => {
    // Chair, on the viewer's side of the desk.
    ctx.fillStyle = C.chair
    roundRect(ctx, seat.x - 1.5, y + 2.2, 3, 2.3, 0.6)
    ctx.fill()
    ctx.fillStyle = C.chairBack
    roundRect(ctx, seat.x - 1.5, y + 3.8, 3, 0.9, 0.4)
    ctx.fill()

    // Monitor
    ctx.fillStyle = C.bezel
    roundRect(ctx, seat.x - 2.1, y - 5.5, 4.2, 3.2, 0.35)
    ctx.fill()
    ctx.fillStyle = C.screen
    roundRect(ctx, seat.x - 1.85, y - 5.25, 3.7, 2.6, 0.2)
    ctx.fill()

    if (litSeats[i]) {
      for (let l = 0; l < 5; l++) {
        const w = 0.7 + ((Math.sin(phase * 1.7 + i * 2.3 + l * 1.1) + 1) / 2) * 2.3
        ctx.fillStyle = l % 3 === 0 ? C.screenOn : C.screenDim
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(phase * 2.4 + l + i)
        ctx.fillRect(seat.x - 1.6, y - 5 + l * 0.47, w, 0.28)
      }
      ctx.globalAlpha = 1
      // Spill light on the desk in front of a live screen.
      ctx.fillStyle = 'rgba(127, 208, 127, 0.10)'
      roundRect(ctx, seat.x - 2.3, y - 2.4, 4.6, 1.6, 0.4)
      ctx.fill()
    } else {
      ctx.fillStyle = C.screenDim
      ctx.globalAlpha = 0.45
      ctx.fillRect(seat.x - 1.6, y - 4.2, 2.3, 0.28)
      ctx.globalAlpha = 1
    }

    ctx.fillStyle = C.monitor
    ctx.fillRect(seat.x - 0.35, y - 2.35, 0.7, 0.5)

    ctx.fillStyle = C.keyboard
    roundRect(ctx, seat.x - 1.5, y - 1.5, 3, 0.85, 0.2)
    ctx.fill()

    // A mug or a paper stack, alternating, so no two stations look identical.
    if (i % 2 === 0) {
      ctx.fillStyle = C.mug
      ctx.beginPath()
      ctx.arc(seat.x + 2.6, y - 0.9, 0.42, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = C.paper
      roundRect(ctx, seat.x + 2.1, y - 1.4, 1.4, 1, 0.1)
      ctx.fill()
    }
  })

  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Mission Control board                                               */
/* ------------------------------------------------------------------ */

/**
 * The big wall screen.
 *
 * Its contents are the project's real numbers - a bar per task bucket, a
 * progress ring, and a scrolling log of what actually happened - because a fake
 * dashboard in the middle of a real one is exactly what this project refuses.
 */
export function drawMissionBoard(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  data: {
    bars: Array<{ value: number; color: string }>
    progress: number
    lines: string[]
  },
  phase: number
): void {
  const x = rect.x + 2
  const y = rect.y + 2
  const w = rect.w - 4
  const h = 6.2

  ctx.save()
  ctx.fillStyle = C.bezel
  roundRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, 0.5)
  ctx.fill()
  ctx.fillStyle = C.screen
  roundRect(ctx, x, y, w, h, 0.35)
  ctx.fill()

  // Left: a bar per task bucket.
  const chartW = w * 0.3
  const max = Math.max(1, ...data.bars.map((b) => b.value))
  data.bars.forEach((bar, i) => {
    const bw = chartW / data.bars.length - 0.45
    const bh = (bar.value / max) * (h - 1.8)
    ctx.fillStyle = bar.color
    roundRect(ctx, x + 0.8 + i * (bw + 0.45), y + h - 0.8 - bh, bw, Math.max(0.22, bh), 0.15)
    ctx.fill()
  })

  // Middle: a progress ring.
  const cx = x + chartW + w * 0.13
  const cy = y + h / 2
  const r = Math.min(h / 2 - 0.7, 2.2)
  ctx.strokeStyle = '#241f1a'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = C.good
  ctx.beginPath()
  ctx.arc(
    cx,
    cy,
    r,
    -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, data.progress))
  )
  ctx.stroke()
  ctx.fillStyle = C.label
  ctx.font = '1.05px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${Math.round(data.progress * 100)}%`, cx, cy)

  // Right: the log, scrolling slowly.
  const logX = cx + r + 1.3
  const logW = x + w - logX - 0.6
  if (logW > 4) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(logX, y + 0.4, logW, h - 0.8)
    ctx.clip()
    ctx.font = '0.72px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const rowH = 0.95
    const offset = (phase * 0.3) % rowH
    data.lines.forEach((line, i) => {
      const ly = y + 0.9 + i * rowH - offset
      if (ly < y + 0.3 || ly > y + h - 0.3) return
      ctx.fillStyle = i === 0 ? C.screenOn : C.screenDim
      ctx.fillText(line.slice(0, Math.max(4, Math.floor(logW / 0.42))), logX, ly)
    })
    ctx.restore()
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Task board                                                          */
/* ------------------------------------------------------------------ */

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  columns: Array<{ label: string; count: number; color: string }>
): void {
  const bx = rect.x + 2.5
  const by = rect.y + 2
  const bw = rect.w - 5
  const bh = rect.h - 7.5

  ctx.save()
  ctx.fillStyle = C.metal
  roundRect(ctx, bx - 0.5, by - 0.5, bw + 1, bh + 1, 0.4)
  ctx.fill()
  ctx.fillStyle = '#cfc7b6'
  roundRect(ctx, bx, by, bw, bh, 0.25)
  ctx.fill()

  const colWidth = bw / columns.length
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  columns.forEach((column, i) => {
    const cx = bx + colWidth * i

    if (i > 0) {
      ctx.strokeStyle = '#a89e8c'
      ctx.lineWidth = 0.12
      ctx.beginPath()
      ctx.moveTo(cx, by + 0.4)
      ctx.lineTo(cx, by + bh - 0.4)
      ctx.stroke()
    }

    ctx.font = '600 0.92px ui-sans-serif, system-ui, sans-serif'
    ctx.fillStyle = '#5d564a'
    ctx.fillText(column.label, cx + colWidth / 2, by + 1.1)
    ctx.strokeStyle = '#a89e8c'
    ctx.lineWidth = 0.1
    ctx.beginPath()
    ctx.moveTo(cx + 0.5, by + 1.8)
    ctx.lineTo(cx + colWidth - 0.5, by + 1.8)
    ctx.stroke()

    // One sticky per task, two per row, capped so a big backlog cannot overflow.
    const noteW = colWidth / 2 - 0.85
    const noteH = 1.4
    const rows = Math.max(0, Math.floor((bh - 3.4) / (noteH + 0.35)))
    const notes = Math.min(column.count, rows * 2)

    for (let n = 0; n < notes; n++) {
      const nx = cx + 0.5 + (n % 2) * (colWidth / 2 - 0.15)
      const ny = by + 2.3 + Math.floor(n / 2) * (noteH + 0.35)
      ctx.fillStyle = column.color
      roundRect(ctx, nx, ny, noteW, noteH, 0.12)
      ctx.fill()
      // A line of "writing", so a sticky is not a flat block of colour.
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'
      ctx.lineWidth = 0.1
      ctx.beginPath()
      ctx.moveTo(nx + 0.25, ny + 0.5)
      ctx.lineTo(nx + noteW - 0.35, ny + 0.5)
      ctx.moveTo(nx + 0.25, ny + 0.92)
      ctx.lineTo(nx + noteW - 0.8, ny + 0.92)
      ctx.stroke()
    }

    if (column.count > notes) {
      ctx.font = '0.82px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = '#5d564a'
      ctx.fillText(`+${column.count - notes}`, cx + colWidth / 2, by + bh - 0.7)
    }
  })
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Robots                                                              */
/* ------------------------------------------------------------------ */

export function drawRobot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: string,
  options: {
    phase: number
    walking: boolean
    scale?: number
    dimmed?: boolean
    selected?: boolean
    ring?: string | null
  }
): void {
  const face: RobotFace = robotFace(seed)
  const s = (options.scale ?? 1) * 0.95
  const bob = options.walking
    ? Math.sin(options.phase * 8) * 0.22
    : Math.sin(options.phase * 1.6) * 0.08

  ctx.save()
  ctx.translate(x, y + bob)
  ctx.scale(s, s)
  ctx.globalAlpha = options.dimmed ? 0.45 : 1

  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.ellipse(0, 1.95, 1.7, 0.6, 0, 0, Math.PI * 2)
  ctx.fill()

  const stride = options.walking ? Math.sin(options.phase * 8) * 0.5 : 0
  ctx.fillStyle = face.dark
  roundRect(ctx, -1.05 + stride, 0.9, 0.8, 1.2, 0.3)
  ctx.fill()
  roundRect(ctx, 0.25 - stride, 0.9, 0.8, 1.2, 0.3)
  ctx.fill()

  ctx.fillStyle = face.glow
  roundRect(ctx, -1.5, -0.6, 3, 1.9, 0.7)
  ctx.fill()
  // A lighter chest plate gives the body some form.
  ctx.fillStyle = face.body
  roundRect(ctx, -0.95, -0.25, 1.9, 1.2, 0.4)
  ctx.fill()

  ctx.fillStyle = face.body
  roundRect(ctx, -1.7, -3.4, 3.4, 3, 0.9)
  ctx.fill()

  if (face.ears) {
    ctx.fillStyle = face.glow
    roundRect(ctx, -2.1, -2.5, 0.5, 1.1, 0.2)
    ctx.fill()
    roundRect(ctx, 1.6, -2.5, 0.5, 1.1, 0.2)
    ctx.fill()
  }
  if (face.antenna) {
    ctx.fillStyle = face.glow
    ctx.fillRect(-0.12, -4.2, 0.24, 0.9)
    ctx.fillStyle = face.visor
    ctx.beginPath()
    ctx.arc(0, -4.35, 0.34, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = '#0d0b09'
  roundRect(ctx, -1.35, -2.75, 2.7, 1.35, 0.4)
  ctx.fill()
  ctx.fillStyle = face.visor
  roundRect(ctx, -0.95, -2.45, 0.55, 0.6, 0.2)
  ctx.fill()
  roundRect(ctx, 0.4, -2.45, 0.55, 0.6, 0.2)
  ctx.fill()

  if (options.ring) {
    ctx.strokeStyle = options.ring
    ctx.lineWidth = 0.22
    roundRect(ctx, -2.1, -4.0, 4.2, 6.2, 1)
    ctx.stroke()
  }
  if (options.selected) {
    ctx.strokeStyle = C.accent
    ctx.lineWidth = 0.3
    roundRect(ctx, -2.3, -4.2, 4.6, 6.6, 1.2)
    ctx.stroke()
  }

  ctx.restore()
}

export function drawNamePlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string
): void {
  ctx.save()
  ctx.font = '1.15px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const w = ctx.measureText(text).width + 1.2
  ctx.fillStyle = 'rgba(13,11,9,0.82)'
  roundRect(ctx, x - w / 2, y + 2.2, w, 1.7, 0.5)
  ctx.fill()
  ctx.fillStyle = C.label
  ctx.fillText(text, x, y + 3.05)
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Speech                                                              */
/* ------------------------------------------------------------------ */

export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  tone: 'say' | 'work' | 'good' | 'warn' | 'bad',
  alpha: number
): void {
  const maxWidth = 19
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = '1.25px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'

  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
    if (lines.length >= 2) break
  }
  if (line && lines.length < 3) lines.push(line)

  const width = Math.min(maxWidth, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 1.8
  const height = lines.length * 1.6 + 1.2
  const top = y - 4.8 - height

  const edge =
    tone === 'good'
      ? C.good
      : tone === 'warn'
        ? C.warn
        : tone === 'bad'
          ? C.bad
          : tone === 'work'
            ? C.accent
            : C.bubbleEdge

  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  roundRect(ctx, x - width / 2 + 0.2, top + 0.25, width, height, 0.9)
  ctx.fill()

  ctx.fillStyle = C.bubble
  roundRect(ctx, x - width / 2, top, width, height, 0.9)
  ctx.fill()
  ctx.strokeStyle = edge
  ctx.lineWidth = 0.2
  ctx.stroke()

  ctx.fillStyle = C.bubble
  ctx.beginPath()
  ctx.moveTo(x - 0.6, top + height - 0.05)
  ctx.lineTo(x, top + height + 1)
  ctx.lineTo(x + 0.6, top + height - 0.05)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = C.bubbleInk
  ctx.textAlign = 'center'
  lines.forEach((l, i) => ctx.fillText(l, x, top + 1.2 + i * 1.6))
  ctx.restore()
}
