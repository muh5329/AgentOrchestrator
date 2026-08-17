import type { RoomId } from './layout'

/**
 * The furniture.
 *
 * Kept apart from the room geometry because it is scenery, not meaning: moving a
 * plant changes nothing about what the floor is claiming. Positions are in world
 * units relative to the room's own origin, so a room can be moved without
 * re-placing everything inside it.
 */

export type Prop =
  | { kind: 'plant'; x: number; y: number; size?: number }
  | { kind: 'whiteboard'; x: number; y: number; w: number }
  | { kind: 'cabinet'; x: number; y: number; w?: number }
  | { kind: 'shelf'; x: number; y: number; w: number; h: number }
  | { kind: 'sofa'; x: number; y: number; w: number }
  | { kind: 'vending'; x: number; y: number }
  | { kind: 'table'; x: number; y: number; r: number }
  | { kind: 'crate'; x: number; y: number }
  | { kind: 'cooler'; x: number; y: number }

/** Which wall the doorway is cut into, as a fraction along that wall. */
export interface Door {
  side: 'top' | 'bottom' | 'left' | 'right'
  at: number
}

export const DECOR: Record<RoomId, { door: Door; props: Prop[] }> = {
  planning: {
    door: { side: 'bottom', at: 0.5 },
    props: [
      { kind: 'whiteboard', x: 3, y: 1, w: 11 },
      { kind: 'cabinet', x: 16, y: 1.2, w: 4 },
      { kind: 'plant', x: 24, y: 3 }
    ]
  },
  mission: {
    door: { side: 'bottom', at: 0.5 },
    props: [
      { kind: 'plant', x: 2.4, y: 12 },
      { kind: 'plant', x: 25.6, y: 12 },
      { kind: 'cabinet', x: 11, y: 9.6, w: 6 }
    ]
  },
  review: {
    door: { side: 'bottom', at: 0.5 },
    props: [
      { kind: 'whiteboard', x: 3, y: 1, w: 11 },
      { kind: 'cabinet', x: 16, y: 1.2, w: 4 },
      { kind: 'plant', x: 24, y: 3 }
    ]
  },
  coding: {
    door: { side: 'top', at: 0.5 },
    props: [
      { kind: 'plant', x: 2.4, y: 13 },
      { kind: 'plant', x: 39.6, y: 13 },
      { kind: 'cabinet', x: 2, y: 1.6, w: 5 },
      { kind: 'cabinet', x: 35, y: 1.6, w: 5 }
    ]
  },
  analysis: {
    door: { side: 'top', at: 0.5 },
    props: [
      { kind: 'plant', x: 2.4, y: 13 },
      { kind: 'plant', x: 39.6, y: 13 },
      { kind: 'cabinet', x: 2, y: 1.6, w: 5 },
      { kind: 'cabinet', x: 35, y: 1.6, w: 5 }
    ]
  },
  board: {
    door: { side: 'top', at: 0.5 },
    props: [
      { kind: 'plant', x: 1.8, y: 12.4 },
      { kind: 'plant', x: 26.2, y: 12.4 }
    ]
  },
  archive: {
    door: { side: 'top', at: 0.5 },
    props: [
      { kind: 'shelf', x: 2, y: 1.6, w: 14, h: 3 },
      { kind: 'shelf', x: 2, y: 5.4, w: 14, h: 3 },
      { kind: 'crate', x: 18.5, y: 2 },
      { kind: 'crate', x: 22.5, y: 2 },
      { kind: 'crate', x: 20.5, y: 5.2 }
    ]
  },
  break: {
    door: { side: 'top', at: 0.5 },
    props: [
      { kind: 'vending', x: 1.6, y: 1.6 },
      { kind: 'sofa', x: 6.5, y: 1.8, w: 9 },
      { kind: 'cooler', x: 24.4, y: 1.8 },
      { kind: 'table', x: 19, y: 6.4, r: 2.4 },
      { kind: 'plant', x: 24.6, y: 7.5 }
    ]
  },
  approval: { door: { side: 'top', at: 0.5 }, props: [] }
}
