import type { Agent, AppEventRecord, Message } from '@shared/models'
import { seedFrom } from '../lib/robot'
import { ROOM_BY_ID, roomFor, spotIn, type RoomId } from './layout'

/**
 * The floor's little world.
 *
 * It is a view, not a toy: every robot corresponds to a row in `agents`, its
 * room is a function of that agent's real status and permissions, and every
 * speech bubble is a real event or a real message with a shorter label on it.
 * Nothing here invents activity - an idle fleet looks idle, which is the point.
 */

export interface Bubble {
  text: string
  tone: 'say' | 'work' | 'good' | 'warn' | 'bad'
  /** Seconds remaining. */
  life: number
  ttl: number
}

export interface Actor {
  id: string
  /** Vertical stagger for this actor's bubble, so neighbours do not collide. */
  lift: number
  name: string
  role: string
  status: string
  room: RoomId
  x: number
  y: number
  tx: number
  ty: number
  phase: number
  walking: boolean
  bubble: Bubble | null
  queue: Bubble[]
}

const WALK_SPEED = 9 // world units per second
const BUBBLE_TTL = 4.5

export class FloorSim {
  readonly actors = new Map<string, Actor>()
  /** Room occupancy for desk assignment, recomputed on every sync. */
  private counts = new Map<RoomId, number>()

  /**
   * Reconcile with the current fleet.
   *
   * Actors persist across syncs so a robot walks to its new desk rather than
   * teleporting - the walk is the only thing on screen that tells you a status
   * just changed.
   */
  sync(agents: Agent[], blockedAgentIds: Set<string>): void {
    const seen = new Set<string>()
    this.counts = new Map()

    for (const agent of agents) {
      seen.add(agent.id)
      const room = roomFor(agent, blockedAgentIds.has(agent.id))
      const index = this.counts.get(room) ?? 0
      this.counts.set(room, index + 1)

      const roomRect = ROOM_BY_ID.get(room)
      if (!roomRect) continue
      const seed = Math.floor(seedFrom(agent.id)() * 1000)
      const spot = spotIn(roomRect, index, seed)

      const existing = this.actors.get(agent.id)
      if (existing) {
        existing.name = agent.name
        existing.status = agent.status
        existing.role = agent.role
        existing.room = room
        existing.tx = spot.x
        existing.ty = spot.y
      } else {
        this.actors.set(agent.id, {
          id: agent.id,
          lift: (index % 2) * 3.4,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          room,
          // New arrivals walk in from the door at the bottom of the floor.
          x: 48,
          y: 60,
          tx: spot.x,
          ty: spot.y,
          phase: Math.random() * 10,
          walking: true,
          bubble: null,
          queue: []
        })
      }
    }

    for (const id of [...this.actors.keys()]) {
      if (!seen.has(id)) this.actors.delete(id)
    }
  }

  /** Advance the world. `dt` is seconds, already scaled by the speed control. */
  tick(dt: number): void {
    for (const actor of this.actors.values()) {
      const dx = actor.tx - actor.x
      const dy = actor.ty - actor.y
      const distance = Math.hypot(dx, dy)

      if (distance > 0.4) {
        const step = Math.min(distance, WALK_SPEED * dt)
        actor.x += (dx / distance) * step
        actor.y += (dy / distance) * step
        actor.walking = true
      } else {
        actor.walking = false
      }

      actor.phase += dt

      if (actor.bubble) {
        actor.bubble.life -= dt
        if (actor.bubble.life <= 0) actor.bubble = null
      }
      // One bubble at a time, so a chatty agent reads as a conversation rather
      // than a wall of overlapping text.
      if (!actor.bubble && actor.queue.length) {
        actor.bubble = actor.queue.shift() ?? null
      }
    }
  }

  say(agentId: string, text: string, tone: Bubble['tone']): void {
    const actor = this.actors.get(agentId)
    if (!actor) return
    // A backed-up queue means the agent is faster than the eye; drop the oldest
    // rather than falling further behind the truth.
    if (actor.queue.length > 3) actor.queue.shift()
    actor.queue.push({ text, tone, life: BUBBLE_TTL, ttl: BUBBLE_TTL })
  }

  at(x: number, y: number): Actor | null {
    for (const actor of this.actors.values()) {
      if (Math.abs(actor.x - x) < 2.4 && y - actor.y > -4.6 && y - actor.y < 2.4) return actor
    }
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Turning the event stream into speech                                */
/* ------------------------------------------------------------------ */

/** Trims a tool input down to the one part worth saying out loud. */
function subject(data: Record<string, unknown> | undefined): string {
  const input = (data?.input ?? {}) as Record<string, unknown>
  const candidate = input.path ?? input.file ?? input.name ?? input.title ?? input.command ?? input.query
  if (typeof candidate !== 'string') return ''
  const short = candidate.length > 34 ? `…${candidate.slice(-32)}` : candidate
  return ` ${short}`
}

const TOOL_PHRASES: Record<string, string> = {
  write_file: 'Writing',
  edit_file: 'Editing',
  read_file: 'Reading',
  list_dir: 'Looking around',
  search_files: 'Searching for',
  run_shell: 'Running',
  run_tests: 'Running tests',
  run_tests_and_report: 'Running tests',
  git_commit: 'Committing',
  git_status: 'Checking the diff',
  create_agent: 'Hiring someone for',
  clone_agent: 'Cloning a colleague',
  invoke_agent: 'Asking a colleague',
  delegate_task: 'Delegating',
  create_task: 'Filing',
  complete_task: 'Marking done',
  request_judgement: 'Sending for review',
  request_approval: 'Needs a human',
  remember: 'Noting',
  recall: 'Remembering',
  send_message: 'Messaging',
  broadcast: 'Announcing',
  web_fetch: 'Fetching',
  run_workflow: 'Kicking off a workflow',
  create_schedule: 'Scheduling'
}

export interface Speech {
  agentId: string
  text: string
  tone: Bubble['tone']
}

/**
 * What an event should make a robot say, or nothing.
 *
 * Deliberately selective: most of the event stream is bookkeeping, and a floor
 * where every row becomes a bubble is unreadable. These are the moments a person
 * watching over the fleet's shoulder would actually notice.
 */
export function speechFor(event: AppEventRecord): Speech | null {
  if (!event.agentId) return null
  const data = event.data as Record<string, unknown> | undefined
  const tool = String(data?.tool ?? '')

  switch (event.type) {
    case 'TOOL_STARTED': {
      const phrase = TOOL_PHRASES[tool]
      if (!phrase) return null
      return { agentId: event.agentId, text: `${phrase}${subject(data)}`, tone: 'work' }
    }
    case 'TOOL_DENIED':
      return { agentId: event.agentId, text: `Not allowed to ${tool || 'do that'}`, tone: 'bad' }
    case 'TOOL_FAILED':
      return { agentId: event.agentId, text: `${tool} failed`, tone: 'warn' }
    case 'APPROVAL_REQUESTED':
      return { agentId: event.agentId, text: 'Waiting on you…', tone: 'warn' }
    case 'APPROVAL_RESOLVED':
      return { agentId: event.agentId, text: 'Thanks — carrying on', tone: 'good' }
    case 'TASK_COMPLETED':
      return { agentId: event.agentId, text: 'Done!', tone: 'good' }
    case 'TASK_FAILED':
      return { agentId: event.agentId, text: 'That did not work', tone: 'bad' }
    case 'JUDGE_APPROVED':
      return { agentId: event.agentId, text: 'Approved', tone: 'good' }
    case 'JUDGE_REJECTED':
      return { agentId: event.agentId, text: 'Sending it back', tone: 'bad' }
    case 'JUDGE_ESCALATED':
      return { agentId: event.agentId, text: 'I need a human on this', tone: 'warn' }
    case 'AGENT_CREATED':
      return { agentId: event.agentId, text: 'Reporting for duty', tone: 'say' }
    case 'WATCHDOG_ALERT':
      return { agentId: event.agentId, text: 'I think I am stuck', tone: 'warn' }
    case 'BUDGET_EXCEEDED':
      return { agentId: event.agentId, text: 'Out of budget', tone: 'bad' }
    case 'EXECUTION_STARTED':
      return { agentId: event.agentId, text: 'On it', tone: 'say' }
    default:
      return null
  }
}

/** Agent-to-agent messages, which are the most literal speech there is. */
export function speechForMessage(message: Message): Speech | null {
  if (!message.fromAgentId) return null
  const text = message.content.replace(/\s+/g, ' ').trim()
  return {
    agentId: message.fromAgentId,
    text: text.length > 90 ? `${text.slice(0, 88)}…` : text,
    tone: 'say'
  }
}
