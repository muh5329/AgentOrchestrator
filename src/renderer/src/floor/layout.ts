import type { Agent } from '@shared/models'

/**
 * The office plan.
 *
 * Rooms are not decoration: each one stands for a real place in the system, and
 * an agent standing in one is a readable claim about what it is doing right now.
 * The mapping is deliberately total - every agent status lands somewhere - so
 * the floor can never show a robot with nowhere to be.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type RoomId =
  | 'mission'
  | 'planning'
  | 'coding'
  | 'analysis'
  | 'review'
  | 'board'
  | 'archive'
  | 'break'
  | 'approval'

export interface Room extends Rect {
  id: RoomId
  label: string
  /** What this room means, shown when you hover it. */
  meaning: string
  /** Desks are where a working agent sits; the rest of the room is walkable. */
  desks: Array<{ x: number; y: number }>
}

/** World units. One unit is one floor tile; the renderer scales from here. */
export const FLOOR: Rect = { x: 0, y: 0, w: 96, h: 62 }

function desks(x: number, y: number, count: number, gap = 7): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, i) => ({ x: x + i * gap, y }))
}

export const ROOMS: Room[] = [
  {
    id: 'mission',
    label: 'Mission Control',
    meaning: 'The Orchestrator: plans the mission, staffs the fleet, delegates.',
    x: 33,
    y: 3,
    w: 30,
    h: 13,
    desks: desks(41, 11, 2, 12)
  },
  {
    id: 'planning',
    label: 'Planning Room',
    meaning: 'Agents that create work rather than do it.',
    x: 3,
    y: 3,
    w: 27,
    h: 13,
    desks: desks(10, 11, 2, 10)
  },
  {
    id: 'review',
    label: 'Review Lab',
    meaning: 'The Judge: scores finished work against its acceptance criteria.',
    x: 66,
    y: 3,
    w: 27,
    h: 13,
    desks: desks(73, 11, 2, 10)
  },
  {
    id: 'coding',
    label: 'Coding Bay',
    meaning: 'Agents that can write files or run commands.',
    x: 3,
    y: 20,
    w: 42,
    h: 16,
    desks: desks(9, 30, 5, 8)
  },
  {
    id: 'analysis',
    label: 'Analysis Desk',
    meaning: 'Agents that read, recall and reason but do not write.',
    x: 50,
    y: 20,
    w: 43,
    h: 16,
    desks: desks(56, 30, 5, 8)
  },
  {
    id: 'board',
    label: 'Task Board',
    meaning: 'The live board: backlog, running, review, done.',
    x: 33,
    y: 40,
    w: 30,
    h: 15,
    desks: desks(41, 52, 2, 12)
  },
  {
    id: 'archive',
    label: 'Archive',
    meaning: 'Project memory: what the fleet has learned and must not forget.',
    x: 74,
    y: 40,
    w: 19,
    h: 15,
    desks: desks(80, 52, 1)
  },
  {
    id: 'break',
    label: 'Break Room',
    meaning: 'Idle and paused agents. Nothing is being spent here.',
    x: 3,
    y: 40,
    w: 26,
    h: 15,
    desks: desks(8, 52, 3, 8.5)
  },
  {
    id: 'approval',
    label: 'Waiting On You',
    meaning: 'Agents blocked on a human decision. They stop until you answer.',
    x: 66,
    y: 20,
    w: 0,
    h: 0,
    desks: []
  }
]

export const ROOM_BY_ID = new Map(ROOMS.map((room) => [room.id, room]))

/**
 * Where an agent belongs right now.
 *
 * Status wins over role, because where an agent *is* should answer "what is
 * happening" before "what is it for" - a paused Orchestrator belongs in the
 * break room, not at the head of the table.
 */
export function roomFor(agent: Agent, blocked: boolean): RoomId {
  if (blocked) return 'approval'
  if (agent.status === 'PAUSED' || agent.status === 'IDLE') return 'break'
  if (agent.role === 'orchestrator') return 'mission'
  if (agent.role === 'judge') return 'review'

  const writes =
    agent.permissions.includes('FILES_WRITE') || agent.permissions.includes('SHELL_EXECUTE')
  if (writes) return 'coding'

  const plans =
    agent.permissions.includes('AGENT_CREATE') || agent.permissions.includes('TASK_CREATE')
  if (plans) return 'planning'

  return 'analysis'
}

/** A deterministic point inside a room, so idle agents do not jitter about. */
export function spotIn(room: Room, index: number, seed: number): { x: number; y: number } {
  if (room.desks.length) {
    const desk = room.desks[index % room.desks.length]
    // Overflow past the desk count stands behind the row rather than overlapping.
    const overflow = Math.floor(index / room.desks.length)
    return { x: desk.x, y: desk.y + overflow * 5 }
  }
  const cols = Math.max(1, Math.floor(room.w / 7))
  return {
    x: room.x + 4 + (index % cols) * 6 + (seed % 3),
    y: room.y + 5 + Math.floor(index / cols) * 6
  }
}
