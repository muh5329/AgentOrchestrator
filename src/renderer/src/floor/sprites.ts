import { robotFace, type RobotFace } from '../lib/robot'

/**
 * Canvas drawing for the floor.
 *
 * Everything is drawn from primitives rather than loaded from an atlas: the
 * fleet is generated at runtime, so its art has to be too. Sizes are in world
 * units and the caller sets the transform, so one function serves every zoom.
 */

export const PALETTE = {
  floorLight: '#26201b',
  floorDark: '#211b17',
  wall: '#0f0c0a',
  wallEdge: '#4d4136',
  roomFill: '#1a1512',
  label: '#b3a595',
  labelDim: '#7c6d5e',
  desk: '#4a3d32',
  deskTop: '#5b4a3b',
  screen: '#0d0b09',
  screenOn: '#6fbf73',
  accent: '#e8913c',
  good: '#6fbf73',
  warn: '#e8b44c',
  bad: '#e06552',
  bubble: '#241f1a',
  bubbleEdge: '#4d4136',
  bubbleInk: '#f0e9e1'
}

/** Checkerboard floor, drawn once per frame under everything else. */
export function drawFloor(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  tile = 4
): void {
  for (let y = 0; y < bounds.h; y += tile) {
    for (let x = 0; x < bounds.w; x += tile) {
      const even = ((x / tile) | 0) % 2 === ((y / tile) | 0) % 2
      ctx.fillStyle = even ? PALETTE.floorLight : PALETTE.floorDark
      ctx.fillRect(bounds.x + x, bounds.y + y, tile, tile)
    }
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

export function drawRoom(
  ctx: CanvasRenderingContext2D,
  room: { x: number; y: number; w: number; h: number; label: string },
  highlighted: boolean
): void {
  ctx.save()
  ctx.fillStyle = PALETTE.roomFill
  roundRect(ctx, room.x, room.y, room.w, room.h, 1.2)
  ctx.fill()

  ctx.lineWidth = highlighted ? 0.5 : 0.3
  ctx.strokeStyle = highlighted ? PALETTE.accent : PALETTE.wallEdge
  ctx.stroke()

  // Label plate, centred on the top wall the way a room sign would be.
  const text = room.label.toUpperCase()
  ctx.font = '600 1.4px ui-sans-serif, system-ui, sans-serif'
  const width = ctx.measureText(text).width + 2.2
  const lx = room.x + room.w / 2 - width / 2
  ctx.fillStyle = PALETTE.wall
  roundRect(ctx, lx, room.y - 1.15, width, 2.3, 0.6)
  ctx.fill()
  ctx.strokeStyle = PALETTE.wallEdge
  ctx.lineWidth = 0.2
  ctx.stroke()

  ctx.fillStyle = highlighted ? PALETTE.accent : PALETTE.label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, room.x + room.w / 2, room.y)
  ctx.restore()
}

/** A desk with a monitor. `busy` lights the screen and scrolls fake code on it. */
export function drawDesk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  busy: boolean,
  phase: number
): void {
  ctx.save()
  ctx.fillStyle = PALETTE.desk
  roundRect(ctx, x - 3.4, y - 0.6, 6.8, 3.4, 0.5)
  ctx.fill()
  ctx.fillStyle = PALETTE.deskTop
  roundRect(ctx, x - 3.4, y - 0.6, 6.8, 2.2, 0.5)
  ctx.fill()

  // Monitor
  ctx.fillStyle = '#2d2620'
  roundRect(ctx, x - 2.3, y - 3.6, 4.6, 3.1, 0.4)
  ctx.fill()
  ctx.fillStyle = PALETTE.screen
  roundRect(ctx, x - 2, y - 3.35, 4, 2.6, 0.25)
  ctx.fill()

  if (busy) {
    // Scrolling "code": three short bars whose widths cycle with the phase.
    ctx.fillStyle = PALETTE.screenOn
    for (let i = 0; i < 4; i++) {
      const w = 1 + ((Math.sin(phase * 2 + i * 1.7) + 1) / 2) * 2.4
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(phase * 3 + i)
      ctx.fillRect(x - 1.75, y - 3.15 + i * 0.6, w, 0.32)
    }
    ctx.globalAlpha = 1
  } else {
    ctx.fillStyle = '#332b24'
    ctx.fillRect(x - 1.75, y - 2.4, 3, 0.32)
  }
  ctx.restore()
}

/**
 * One robot, top-down-ish: a rounded body, a visor, and the same generated
 * plate pattern the SVG avatar uses, so it is recognisably the same character.
 */
export function drawRobot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: string,
  options: {
    /** 0..1 walk cycle, drives the bob and the legs. */
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
  const bob = options.walking ? Math.sin(options.phase * 8) * 0.22 : Math.sin(options.phase * 1.6) * 0.08

  ctx.save()
  ctx.translate(x, y + bob)
  ctx.scale(s, s)
  ctx.globalAlpha = options.dimmed ? 0.42 : 1

  // Contact shadow keeps it planted on the floor rather than floating.
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.beginPath()
  ctx.ellipse(0, 1.9, 1.7, 0.6, 0, 0, Math.PI * 2)
  ctx.fill()

  // Legs
  const stride = options.walking ? Math.sin(options.phase * 8) * 0.5 : 0
  ctx.fillStyle = face.dark
  roundRect(ctx, -1.05 + stride, 0.9, 0.8, 1.2, 0.3)
  ctx.fill()
  roundRect(ctx, 0.25 - stride, 0.9, 0.8, 1.2, 0.3)
  ctx.fill()

  // Body
  ctx.fillStyle = face.glow
  roundRect(ctx, -1.5, -0.6, 3, 1.9, 0.7)
  ctx.fill()

  // Head
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

  // Visor and eyes
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
    ctx.strokeStyle = PALETTE.accent
    ctx.lineWidth = 0.3
    roundRect(ctx, -2.3, -4.2, 4.6, 6.6, 1.2)
    ctx.stroke()
  }

  ctx.restore()
}

/** A name plate under a robot; only drawn when zoomed in enough to read. */
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
  ctx.fillStyle = 'rgba(13,11,9,0.78)'
  roundRect(ctx, x - w / 2, y + 1.7, w, 1.7, 0.5)
  ctx.fill()
  ctx.fillStyle = PALETTE.label
  ctx.fillText(text, x, y + 2.55)
  ctx.restore()
}

/**
 * A speech bubble above a robot.
 *
 * Wrapped by measurement rather than character count, because tool names and
 * file paths are long and unbreakable and a naive wrap loses the end of them.
 */
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
  const top = y - 4.6 - height

  const edge =
    tone === 'good'
      ? PALETTE.good
      : tone === 'warn'
        ? PALETTE.warn
        : tone === 'bad'
          ? PALETTE.bad
          : tone === 'work'
            ? PALETTE.accent
            : PALETTE.bubbleEdge

  ctx.fillStyle = PALETTE.bubble
  roundRect(ctx, x - width / 2, top, width, height, 0.9)
  ctx.fill()
  ctx.strokeStyle = edge
  ctx.lineWidth = 0.2
  ctx.stroke()

  // Tail
  ctx.fillStyle = PALETTE.bubble
  ctx.beginPath()
  ctx.moveTo(x - 0.6, top + height - 0.05)
  ctx.lineTo(x, top + height + 1)
  ctx.lineTo(x + 0.6, top + height - 0.05)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = PALETTE.bubbleInk
  ctx.textAlign = 'center'
  lines.forEach((l, i) => ctx.fillText(l, x, top + 1.2 + i * 1.6))
  ctx.restore()
}

/** The task board, drawn with the real column counts written on it. */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  columns: Array<{ label: string; count: number; color: string }>
): void {
  ctx.save()
  const bx = rect.x + 3
  const by = rect.y + 4
  const bw = rect.w - 6
  const bh = rect.h - 11

  ctx.fillStyle = '#0d0b09'
  roundRect(ctx, bx, by, bw, bh, 0.6)
  ctx.fill()
  ctx.strokeStyle = PALETTE.wallEdge
  ctx.lineWidth = 0.25
  ctx.stroke()

  const colWidth = bw / columns.length
  ctx.font = '1.05px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  columns.forEach((column, i) => {
    const cx = bx + colWidth * i
    if (i > 0) {
      ctx.strokeStyle = '#241f1a'
      ctx.beginPath()
      ctx.moveTo(cx, by + 0.5)
      ctx.lineTo(cx, by + bh - 0.5)
      ctx.stroke()
    }
    ctx.fillStyle = PALETTE.labelDim
    ctx.fillText(column.label, cx + colWidth / 2, by + 1.8)

    // One sticky note per task, capped so a big backlog does not overflow.
    const notes = Math.min(column.count, 9)
    for (let n = 0; n < notes; n++) {
      const nx = cx + 1.2 + (n % 2) * (colWidth / 2 - 0.4)
      const ny = by + 3.4 + Math.floor(n / 2) * 2.2
      if (ny > by + bh - 2) break
      ctx.fillStyle = column.color
      roundRect(ctx, nx, ny, colWidth / 2 - 1.6, 1.6, 0.3)
      ctx.fill()
    }
    if (column.count > notes) {
      ctx.fillStyle = PALETTE.labelDim
      ctx.fillText(`+${column.count - notes}`, cx + colWidth / 2, by + bh - 1.4)
    }
  })
  ctx.restore()
}
