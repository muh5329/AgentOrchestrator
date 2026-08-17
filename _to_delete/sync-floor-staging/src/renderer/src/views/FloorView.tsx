import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { FLOOR, ROOMS, ROOM_BY_ID, SEAT_OFFSET } from '../floor/layout'
import { DECOR } from '../floor/decor'
import {
  PALETTE,
  drawBench,
  drawBoard,
  drawBubble,
  drawBuilding,
  drawMissionBoard,
  drawNamePlate,
  drawProp,
  drawRobot,
  drawRoom
} from '../floor/sprites'
import { speechFor, speechForMessage, worldFor } from '../floor/sim'
import { RobotAvatar } from '../components/RobotAvatar'
import { formatCost, formatRelative, StatusDot } from '../ui'

/**
 * The fleet as an office you can watch.
 *
 * Every other view answers a question you already had. This one answers the
 * question you did not know to ask - "what is actually going on right now" -
 * by putting the whole fleet in one frame and letting motion carry the state.
 *
 * It is a projection of real rows, not a simulation: robots stand where their
 * agent's status and permissions put them, the board shows the real column
 * counts, and every speech bubble is an event or a message that genuinely
 * happened. When nothing is running, the office is still, and that is correct.
 */
export function FloorView({ projectId }: { projectId: string }): React.JSX.Element {
  // Keyed by project so the scene's own state is always adopted from that
  // project's world at mount, and never carried across from another one.
  return <FloorScene key={projectId} projectId={projectId} />
}

function FloorScene({ projectId }: { projectId: string }): React.JSX.Element {
  const store = useStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef({ scale: 1, ox: 0, oy: 0 })

  // The world outlives this component. Closing the tab and opening it again
  // should return you to the office as you left it, not re-hire everyone.
  const world = worldFor(projectId)
  const simRef = useRef(world.sim)
  simRef.current = world.sim
  const seenRef = useRef(world.spoken)
  seenRef.current = world.spoken

  const [playing, setPlaying] = useState(world.view.playing)
  const [speed, setSpeed] = useState(world.view.speed)
  const [zoom, setZoom] = useState(world.view.zoom)
  const [hovered, setHovered] = useState<{ name: string; detail: string } | null>(null)
  const [hud, setHud] = useState(world.view.hud)
  const hudRef = useRef(hud)
  hudRef.current = hud

  // Mirror the controls back so they survive the next unmount too.
  world.view.playing = playing
  world.view.speed = speed
  world.view.zoom = zoom
  world.view.hud = hud

  const agents = store.agents
  const blocked = useMemo(
    () => new Set(store.approvals.map((a) => a.agentId).filter(Boolean) as string[]),
    [store.approvals]
  )

  // Keep the cast in step with the fleet.
  useEffect(() => {
    simRef.current.sync(agents, blocked)
  }, [agents, blocked])

  /**
   * A read-only seam for the interface harness: where every robot stands now.
   *
   * The floor is the one view whose correctness is a property of motion over
   * time - "did they stay put when I left and came back" cannot be asserted
   * from the DOM. It reads state that is already on screen and can change
   * nothing, and it is torn down with the view.
   */
  useEffect(() => {
    const host = window as unknown as { __aoFloorProbe?: () => unknown }
    host.__aoFloorProbe = () =>
      [...simRef.current.actors.values()].map((a) => ({ id: a.id, x: a.x, y: a.y }))
    return () => {
      delete host.__aoFloorProbe
    }
  }, [])

  /**
   * Feed the world from the live streams.
   *
   * The store keeps a rolling buffer rather than a feed, so this tracks which
   * ids have already been spoken - otherwise every refresh would replay the
   * entire buffer as a fresh burst of chatter.
   */
  useEffect(() => {
    const seen = seenRef.current
    const fresh = store.events.filter((event) => !seen.has(event.id)).reverse()
    for (const event of fresh) {
      seen.add(event.id)
      const speech = speechFor(event)
      if (speech) simRef.current.say(speech.agentId, speech.text, speech.tone)
    }
    // Trimmed in place: this set belongs to the world, and replacing it here
    // would quietly hand the world a stale one and let the buffer replay.
    if (seen.size > 2000) {
      const keep = [...seen].slice(-1000)
      seen.clear()
      for (const id of keep) seen.add(id)
    }
  }, [store.events])

  useEffect(() => {
    const seen = seenRef.current
    for (const message of store.messages) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      const speech = speechForMessage(message)
      if (speech) simRef.current.say(speech.agentId, speech.text, speech.tone)
    }
  }, [store.messages])

  const columns = useMemo(() => {
    const count = (statuses: string[]): number =>
      store.tasks.filter((t) => statuses.includes(t.status)).length
    return [
      { label: 'BACKLOG', count: count(['BACKLOG', 'READY']), color: '#7c6d5e' },
      { label: 'RUNNING', count: count(['RUNNING', 'QUEUED']), color: PALETTE.accent },
      { label: 'REVIEW', count: count(['REVIEW', 'BLOCKED']), color: PALETTE.warn },
      { label: 'DONE', count: count(['COMPLETED']), color: PALETTE.good }
    ]
  }, [store.tasks])

  /** What the wall screen in Mission Control shows: all of it real. */
  const mission = useMemo(() => {
    const lines = store.events
      .slice(0, 14)
      .map((event) => `${event.type.toLowerCase().replace(/_/g, ' ')} ${event.message}`)
    return {
      bars: columns.map((c) => ({ value: c.count, color: c.color })),
      progress: store.stats?.progress ?? 0,
      lines: lines.length ? lines : ['awaiting work']
    }
  }, [columns, store.events, store.stats])

  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const missionRef = useRef(mission)
  missionRef.current = mission
  const hoveredRoomRef = useRef<string | null>(null)
  const selectedRef = useRef(store.selectedAgentId)
  selectedRef.current = store.selectedAgentId
  const playingRef = useRef(playing)
  playingRef.current = playing
  const speedRef = useRef(speed)
  speedRef.current = speed
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const memoryCountRef = useRef(store.memories.length)
  memoryCountRef.current = store.memories.length

  /* ---------------------------------------------------------------- */
  /* The render loop                                                   */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let last = performance.now()

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const render = (now: number): void => {
      const dtRaw = Math.min((now - last) / 1000, 0.1)
      last = now
      if (playingRef.current) simRef.current.tick(dtRaw * speedRef.current)

      const dpr = window.devicePixelRatio || 1
      const width = canvas.width / dpr
      const height = canvas.height / dpr

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = PALETTE.shellOuter
      ctx.fillRect(0, 0, width, height)

      // Fit to the whole pane rather than to the gap between the overlays.
      // Reserving their width made the floor a postage stamp - the plan is
      // wide and the pane is tall, so the horizontal budget is what binds. The
      // panels are translucent and dismissible instead, so what they cover is
      // still legible and can be got out of the way entirely.
      // Only the left column is reserved. The overheard feed is short and sits
      // over the archive in the bottom right, which is the least load-bearing
      // corner of the plan.
      const padL = hudRef.current && width > 900 ? 210 : 14
      const padR = 14
      const padT = 14
      const padB = 58
      const availW = Math.max(160, width - padL - padR)
      const availH = Math.max(140, height - padT - padB)

      const base = Math.min(availW / (FLOOR.w + 2), availH / (FLOOR.h + 3))
      const scale = base * zoomRef.current
      const ox = padL + availW / 2 - (FLOOR.w / 2) * scale
      const oy = padT + availH / 2 - (FLOOR.h / 2) * scale
      cameraRef.current = { scale, ox, oy }

      ctx.translate(ox, oy)
      ctx.scale(scale, scale)

      drawBuilding(ctx, FLOOR)

      // Rooms, then their furniture, then the two feature installations.
      for (const room of ROOMS) {
        if (room.w === 0) continue
        drawRoom(ctx, room, DECOR[room.id].door, hoveredRoomRef.current === room.id)
        for (const prop of DECOR[room.id].props) drawProp(ctx, room.x, room.y, prop)
      }

      const mission = ROOM_BY_ID.get('mission')
      if (mission) drawMissionBoard(ctx, mission, missionRef.current, now / 1000)

      const board = ROOM_BY_ID.get('board')
      if (board) drawBoard(ctx, board, columnsRef.current)

      // Benches, with a seat lit when the agent sitting there is running.
      const actorList = [...simRef.current.actors.values()]
      for (const room of ROOMS) {
        if (!room.desks.length) continue
        const lit = room.desks.map((desk) =>
          actorList.some(
            (a) =>
              a.status === 'RUNNING' &&
              Math.abs(a.x - desk.x) < 2.5 &&
              Math.abs(a.y - (desk.y + SEAT_OFFSET)) < 2.5
          )
        )
        drawBench(ctx, room.desks, lit, now / 1000)
      }

      // Robots, painted back to front so overlaps look right.
      const actors = [...simRef.current.actors.values()].sort((a, b) => a.y - b.y)
      for (const actor of actors) {
        const ring =
          actor.status === 'RUNNING'
            ? PALETTE.good
            : actor.status === 'BLOCKED'
              ? PALETTE.warn
              : actor.status === 'FAILED'
                ? PALETTE.bad
                : null
        drawRobot(ctx, actor.x, actor.y, actor.id, {
          phase: actor.phase,
          walking: actor.walking,
          dimmed: actor.status === 'PAUSED',
          selected: actor.id === selectedRef.current,
          ring
        })
        if (zoomRef.current >= 1.5) drawNamePlate(ctx, actor.x, actor.y, actor.name)
      }

      // Bubbles last: they must never be occluded by a robot in front.
      for (const actor of actors) {
        if (!actor.bubble) continue
        const fade = Math.min(1, actor.bubble.life / 0.6)
        drawBubble(ctx, actor.x, actor.y - actor.lift, actor.bubble.text, actor.bubble.tone, fade)
      }

      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  /** Screen point to world point, using the camera the last frame set up. */
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { scale, ox, oy } = cameraRef.current
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale }
  }

  const onMove = (e: React.MouseEvent): void => {
    const point = toWorld(e.clientX, e.clientY)
    if (!point) return
    const actor = simRef.current.at(point.x, point.y)
    if (actor) {
      hoveredRoomRef.current = null
      setHovered({ name: actor.name, detail: `${actor.status.toLowerCase()} · ${actor.room}` })
      return
    }
    const room = ROOMS.find(
      (r) => r.w > 0 && point.x > r.x && point.x < r.x + r.w && point.y > r.y && point.y < r.y + r.h
    )
    hoveredRoomRef.current = room?.id ?? null
    setHovered(room ? { name: room.label, detail: room.meaning } : null)
  }

  const onClick = (e: React.MouseEvent): void => {
    const point = toWorld(e.clientX, e.clientY)
    if (!point) return
    const actor = simRef.current.at(point.x, point.y)
    if (!actor) return
    store.selectAgent(actor.id)
    store.openTab({ kind: 'agent', projectId, agentId: actor.id, title: actor.name })
  }

  const running = agents.filter((a) => a.status === 'RUNNING').length
  const idle = agents.filter((a) => a.status === 'IDLE').length
  const paused = agents.filter((a) => a.status === 'PAUSED').length
  const byRole = agents.reduce<Record<string, number>>((acc, a) => {
    acc[a.role] = (acc[a.role] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-base-900">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-pointer"
        onMouseMove={onMove}
        onMouseLeave={() => {
          hoveredRoomRef.current = null
          setHovered(null)
        }}
        onClick={onClick}
      />

      {/* Overview, top left */}
      {hud && (
      <Panel className="left-3 top-3 w-48">
        <PanelTitle>Floor</PanelTitle>
        <Row label="Agents" value={String(agents.length)} />
        <Row label="Working" value={String(running)} tone={running ? 'good' : undefined} />
        <Row label="Idle" value={String(idle)} />
        <Row label="Paused" value={String(paused)} tone={paused ? 'warn' : undefined} />
        <Row
          label="Waiting on you"
          value={String(store.approvals.length)}
          tone={store.approvals.length ? 'warn' : undefined}
        />
        <div className="my-2 border-t border-edge" />
        <Row label="Tasks done" value={String(columns[3].count)} />
        <Row label="Spend" value={formatCost(store.stats?.costUsd ?? 0)} />

        <div className="my-2 border-t border-edge" />
        <PanelTitle>Roll call</PanelTitle>
        {Object.entries(byRole).map(([role, count]) => (
          <Row key={role} label={role} value={String(count)} />
        ))}
        {agents.length === 0 && (
          <p className="text-2xs text-ink-faint">
            No agents yet. Launch the project and the Orchestrator staffs the floor.
          </p>
        )}
      </Panel>
      )}

      {/* Activity, right */}
      {hud && (
      <Panel className="bottom-14 left-3 top-52 flex w-48 flex-col">
        <PanelTitle>Overheard</PanelTitle>
        <div className="scroll-y -mr-1 min-h-0 flex-1 pr-1">
          {store.events.slice(0, 40).map((event) => {
            const speech = speechFor(event)
            if (!speech) return null
            const agent = agents.find((a) => a.id === speech.agentId)
            if (!agent) return null
            return (
              <button
                key={event.id}
                onClick={() => {
                  store.selectAgent(agent.id)
                  store.openTab({
                    kind: 'agent',
                    projectId,
                    agentId: agent.id,
                    title: agent.name
                  })
                }}
                className="mb-1.5 flex w-full gap-1.5 text-left"
              >
                <RobotAvatar seed={agent.id} size={18} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-2xs text-ink-dim">{agent.name}</span>
                    <span className="flex-1" />
                    <span className="shrink-0 text-2xs text-ink-faint">
                      {formatRelative(event.createdAt)}
                    </span>
                  </span>
                  <span
                    className={clsx(
                      'block truncate text-2xs',
                      speech.tone === 'good'
                        ? 'text-good'
                        : speech.tone === 'bad'
                          ? 'text-bad'
                          : speech.tone === 'warn'
                            ? 'text-warn'
                            : 'text-ink-faint'
                    )}
                  >
                    {speech.text}
                  </span>
                </span>
              </button>
            )
          })}
          {store.events.length === 0 && (
            <p className="text-2xs text-ink-faint">Nothing has happened yet.</p>
          )}
        </div>
      </Panel>
      )}

      {/* Hover readout */}
      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-3 max-w-md -translate-x-1/2 rounded-lg border border-edge bg-base-850/95 px-3 py-1.5 text-center">
          <div className="text-xs text-ink">{hovered.name}</div>
          <div className="text-2xs text-ink-faint">{hovered.detail}</div>
        </div>
      )}

      {/* Transport */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-edge bg-base-850/95 px-1.5 py-1">
        <Control onClick={() => setPlaying(!playing)} active={!playing} title={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </Control>
        <span className="mx-1 h-4 w-px bg-edge" />
        {[1, 2, 4].map((value) => (
          <Control
            key={value}
            onClick={() => setSpeed(value)}
            active={speed === value}
            title={`${value}x`}
          >
            {value}×
          </Control>
        ))}
        <span className="mx-1 h-4 w-px bg-edge" />
        <Control onClick={() => setZoom((z) => Math.max(0.6, z - 0.25))} title="Zoom out">
          −
        </Control>
        <Control onClick={() => setZoom(1)} title="Fit">
          ⤢
        </Control>
        <Control onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))} title="Zoom in">
          +
        </Control>
        <span className="mx-1 h-4 w-px bg-edge" />
        <Control onClick={() => setHud(!hud)} active={!hud} title={hud ? 'Hide panels' : 'Show panels'}>
          ▤
        </Control>
        <span className="mx-1 h-4 w-px bg-edge" />
        <span className="flex items-center gap-1 px-1 text-2xs text-ink-faint">
          <StatusDot status={running ? 'RUNNING' : 'IDLE'} />
          live
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Overlay chrome                                                      */
/* ------------------------------------------------------------------ */

function Panel({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={clsx(
        'absolute rounded-lg border border-edge/80 bg-base-850/80 px-3 py-2 backdrop-blur-md',
        className
      )}
    >
      {children}
    </div>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-1.5 text-2xs uppercase tracking-wider text-ink-faint">{children}</div>
  )
}

function Row({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'good' | 'warn'
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="flex-1 truncate capitalize text-ink-faint">{label}</span>
      <span
        className={clsx(
          'tabular-nums',
          tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : 'text-ink-dim'
        )}
      >
        {value}
      </span>
    </div>
  )
}

function Control({
  children,
  onClick,
  active,
  title
}: {
  children: React.ReactNode
  onClick(): void
  active?: boolean
  title: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        'rounded px-2 py-0.5 text-xs transition-colors',
        active ? 'bg-accent-soft text-accent' : 'text-ink-dim hover:bg-base-750 hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}
