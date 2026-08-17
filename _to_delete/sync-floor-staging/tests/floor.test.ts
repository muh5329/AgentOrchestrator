import { describe, expect, it } from 'vitest'
import { FloorSim, worldFor } from '../src/renderer/src/floor/sim'
import type { Agent } from '../src/shared/models'

/**
 * The floor is a place, and a place does not rebuild itself because you looked
 * away.
 *
 * These cover the two properties that make it feel like one: a robot already on
 * the floor keeps standing where it is when the fleet is re-read, and the world
 * survives the component that draws it, so closing the tab and opening it again
 * does not re-hire everyone at the door.
 */

function agent(id: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    projectId: 'prj_1',
    parentAgentId: null,
    createdByAgentId: null,
    name: id,
    role: 'worker',
    description: '',
    systemPrompt: '',
    provider: 'scripted',
    model: 'test',
    temperature: 0.7,
    status: 'IDLE',
    permissions: ['FILES_READ'],
    depth: 0,
    maxChildren: null,
    maxDepth: null,
    isBuiltIn: false,
    config: {},
    createdAt: 0,
    updatedAt: 0,
    lastActiveAt: null,
    ...over
  } as Agent
}

/** Runs the world forward until everyone has arrived, or gives up. */
function settle(sim: FloorSim): void {
  for (let i = 0; i < 600; i++) {
    sim.tick(0.05)
    if (![...sim.actors.values()].some((a) => a.walking)) return
  }
}

describe('actors keep their place', () => {
  it('does not move a seated robot when the fleet is re-read unchanged', () => {
    const sim = new FloorSim()
    const fleet = [agent('a'), agent('b'), agent('c')]

    sim.sync(fleet, new Set())
    settle(sim)
    const before = [...sim.actors.values()].map((a) => ({ id: a.id, x: a.x, y: a.y }))
    expect(before.every((p) => p.y < 60)).toBe(true) // they left the door

    sim.sync(fleet, new Set())
    for (const point of before) {
      const actor = sim.actors.get(point.id)!
      expect(actor.x).toBeCloseTo(point.x, 5)
      expect(actor.y).toBeCloseTo(point.y, 5)
      expect(actor.walking).toBe(false)
    }
  })

  it('walks a robot to its new desk rather than teleporting it', () => {
    const sim = new FloorSim()
    sim.sync([agent('a')], new Set())
    settle(sim)
    const seated = { ...sim.actors.get('a')! }

    // A status change moves it to another room.
    sim.sync([agent('a', { status: 'RUNNING' })], new Set())
    const actor = sim.actors.get('a')!
    expect(actor.x).toBeCloseTo(seated.x, 5)
    expect(actor.y).toBeCloseTo(seated.y, 5)
    // The target moved, so the next tick starts a walk.
    sim.tick(0.05)
    expect(actor.walking).toBe(true)
  })

  it('brings a genuinely new agent in through the door', () => {
    const sim = new FloorSim()
    sim.sync([agent('a')], new Set())
    settle(sim)

    sim.sync([agent('a'), agent('b')], new Set())
    expect(sim.actors.get('b')!.y).toBe(60)
    expect(sim.actors.get('b')!.walking).toBe(true)
    // ...without disturbing the one already at its desk.
    expect(sim.actors.get('a')!.walking).toBe(false)
  })

  it('forgets an agent that has left the fleet', () => {
    const sim = new FloorSim()
    sim.sync([agent('a'), agent('b')], new Set())
    sim.sync([agent('a')], new Set())
    expect(sim.actors.has('b')).toBe(false)
  })
})

describe('the world outlives the view', () => {
  it('hands back the same world for a project, so positions survive a remount', () => {
    const world = worldFor('prj_persist')
    world.sim.sync([agent('a')], new Set())
    settle(world.sim)
    const seated = { ...world.sim.actors.get('a')! }

    // What a remount does: ask for the world again and re-sync.
    const again = worldFor('prj_persist')
    expect(again).toBe(world)
    again.sim.sync([agent('a')], new Set())

    const actor = again.sim.actors.get('a')!
    expect(actor.x).toBeCloseTo(seated.x, 5)
    expect(actor.y).toBeCloseTo(seated.y, 5)
    expect(actor.y).not.toBe(60) // not back at the door
  })

  it('keeps what has already been said, so a remount is not a shouting match', () => {
    const world = worldFor('prj_spoken')
    world.spoken.add('evt_1')
    expect(worldFor('prj_spoken').spoken.has('evt_1')).toBe(true)
  })

  it('keeps the view controls a person set', () => {
    const world = worldFor('prj_controls')
    world.view.speed = 4
    world.view.hud = false
    expect(worldFor('prj_controls').view).toEqual(
      expect.objectContaining({ speed: 4, hud: false })
    )
  })

  it('gives a different project its own floor', () => {
    expect(worldFor('prj_one')).not.toBe(worldFor('prj_two'))
  })

  it('does not grow without bound as projects are opened', () => {
    const first = worldFor('prj_evictable')
    for (let i = 0; i < 12; i++) worldFor(`prj_filler_${i}`)
    // Evicted, so a fresh world comes back rather than the old one.
    expect(worldFor('prj_evictable')).not.toBe(first)
  })
})
