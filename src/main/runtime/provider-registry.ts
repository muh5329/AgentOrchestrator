import { eq } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { AppError } from '../core/errors'
import { providers as providersTable, settings as settingsTable } from '../db/schema'
import { id } from '../util/id'
import { now } from '../util/time'
import type { ProviderAdapter, ProviderAvailability } from './provider-types'
import type { ScriptedAdapter } from './providers/scripted'

export interface ProviderInfo {
  id: string
  label: string
  kind: string
  availability: ProviderAvailability | null
}

/**
 * Provider abstraction. Nothing above this layer knows whether an agent is
 * being run by a local CLI, a hosted API or a deterministic test double.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()
  private readonly availability = new Map<string, ProviderAvailability>()

  constructor(private readonly ctx: AppContext) {}

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId)
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId)
    if (!adapter) {
      throw new AppError(
        `No provider adapter registered for "${providerId}". Configure one in Settings → Providers.`,
        'NO_PROVIDER',
        { providerId, known: [...this.adapters.keys()] }
      )
    }
    return adapter
  }

  scripted(): ScriptedAdapter | undefined {
    return this.adapters.get('scripted') as ScriptedAdapter | undefined
  }

  list(): ProviderInfo[] {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      kind: adapter.kind,
      availability: this.availability.get(adapter.id) ?? null
    }))
  }

  async checkAll(): Promise<ProviderInfo[]> {
    for (const adapter of this.adapters.values()) {
      try {
        this.availability.set(adapter.id, await adapter.check())
      } catch (err) {
        this.availability.set(adapter.id, {
          available: false,
          detail: (err as Error).message
        })
      }
    }
    this.persist()
    return this.list()
  }

  availabilityOf(providerId: string): ProviderAvailability | null {
    return this.availability.get(providerId) ?? null
  }

  /** Mirrors registered adapters into the providers table for the UI. */
  private persist(): void {
    for (const adapter of this.adapters.values()) {
      const existing = this.ctx.db
        .select()
        .from(providersTable)
        .where(eq(providersTable.adapter, adapter.id))
        .get()
      const available = this.availability.get(adapter.id)
      const values = {
        name: adapter.label,
        kind: adapter.kind,
        adapter: adapter.id,
        enabled: available?.available ?? false,
        config: { detail: available?.detail ?? '', version: available?.version ?? '' },
        updatedAt: now()
      }
      if (existing) {
        this.ctx.db.update(providersTable).set(values).where(eq(providersTable.id, existing.id)).run()
      } else {
        this.ctx.db
          .insert(providersTable)
          .values({ id: id('prv'), createdAt: now(), ...values })
          .run()
      }
    }
  }

  /**
   * Resolves the model an execution should use. "auto" routes by task weight:
   * cheap models for small, mechanical work and strong models for reasoning.
   */
  resolveModel(agentModel: string, hints: { priority: number; isJudge: boolean }): string {
    if (agentModel !== 'auto') return agentModel
    if (hints.isJudge) return 'sonnet'
    if (hints.priority >= 80) return 'opus'
    if (hints.priority <= 30) return 'haiku'
    return 'sonnet'
  }

  getSecret(key: string): string | null {
    const row = this.ctx.db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()
    return row ? (row.value as string) : null
  }

  setSecret(key: string, value: string | null): void {
    const existing = this.ctx.db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()
    if (existing) {
      this.ctx.db
        .update(settingsTable)
        .set({ value, updatedAt: now() })
        .where(eq(settingsTable.key, key))
        .run()
    } else {
      this.ctx.db.insert(settingsTable).values({ key, value, updatedAt: now() }).run()
    }
  }
}
