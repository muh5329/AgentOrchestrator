import { EventEmitter } from 'node:events'
import type { EventLevel, EventType } from '../../shared/domain'
import { events as eventsTable } from '../db/schema'
import type { DB } from '../db/client'
import { id } from '../util/id'
import { now } from '../util/time'

export interface AppEvent {
  id: string
  type: EventType
  level: EventLevel
  message: string
  projectId?: string | null
  agentId?: string | null
  taskId?: string | null
  executionId?: string | null
  data: Record<string, unknown>
  createdAt: number
}

export interface EmitOptions {
  type: EventType
  message?: string
  level?: EventLevel
  projectId?: string | null
  agentId?: string | null
  taskId?: string | null
  executionId?: string | null
  data?: Record<string, unknown>
  /** High-frequency streaming events are broadcast but not written to disk. */
  persist?: boolean
}

type Listener = (event: AppEvent) => void

/**
 * The single nervous system of the application.
 *
 * Everything that happens - an agent spawning, a tool being denied, a judge
 * rejecting work - passes through here. The bus persists the durable record,
 * fans out to in-process subscribers (scheduler, watchdog, workflow engine)
 * and to the renderer bridge so the UI is live without polling.
 */
export class EventBus {
  private readonly emitter = new EventEmitter()
  private readonly sinks = new Set<Listener>()

  constructor(private readonly db: DB) {
    this.emitter.setMaxListeners(200)
  }

  emit(options: EmitOptions): AppEvent {
    const event: AppEvent = {
      id: id('evt'),
      type: options.type,
      level: options.level ?? 'info',
      message: options.message ?? '',
      projectId: options.projectId ?? null,
      agentId: options.agentId ?? null,
      taskId: options.taskId ?? null,
      executionId: options.executionId ?? null,
      data: options.data ?? {},
      createdAt: now()
    }

    if (options.persist !== false) {
      try {
        this.db.insert(eventsTable).values(event).run()
      } catch (err) {
        // Never let observability failures break the run.
        console.error('[event-bus] failed to persist event', err)
      }
    }

    this.emitter.emit(event.type, event)
    this.emitter.emit('*', event)
    for (const sink of this.sinks) {
      try {
        sink(event)
      } catch (err) {
        console.error('[event-bus] sink threw', err)
      }
    }
    return event
  }

  on(type: EventType | '*', listener: Listener): () => void {
    this.emitter.on(type, listener)
    return () => this.emitter.off(type, listener)
  }

  once(type: EventType, listener: Listener): void {
    this.emitter.once(type, listener)
  }

  /** Register an external consumer, e.g. the renderer IPC bridge. */
  addSink(sink: Listener): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }

  /** Resolves when a matching event arrives, or rejects on timeout. */
  waitFor(
    type: EventType,
    predicate: (e: AppEvent) => boolean,
    timeoutMs = 60_000
  ): Promise<AppEvent> {
    return new Promise((resolve, reject) => {
      const off = this.on(type, (e) => {
        if (!predicate(e)) return
        clearTimeout(timer)
        off()
        resolve(e)
      })
      const timer = setTimeout(() => {
        off()
        reject(new Error(`Timed out waiting for ${type}`))
      }, timeoutMs)
    })
  }
}
