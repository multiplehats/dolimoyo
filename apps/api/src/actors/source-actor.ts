import { DurableObject } from 'cloudflare:workers'
import { and, eq, sql } from 'drizzle-orm'
import { schema, type Database } from '@uitagenda/db'
import type { CSSScraperConfig } from '@uitagenda/scrapers'
import type { Env } from '../env'
import { createDbForEnv } from '../services/db'
import { createLedger } from '../services/ledger'
import { createParsewForEnv } from '../services/parsew'
import { createLLMForEnv } from '../services/llm'
import { generateScraper } from '../pipeline/generate-scraper'
import { refreshSource, type EventRow, type StoredScraper } from '../pipeline/refresh'
import { quantizeDay } from '../pipeline/digest'

type Phase = 'generate' | 'refresh' | 'regen'
const DAILY_MS = 24 * 60 * 60 * 1000

export class SourceActor extends DurableObject<Env> {
  /**
   * Bootstrap RPC. Called from SubscriptionActor after persisting the source row.
   * Returns IMMEDIATELY after persisting state + scheduling the first alarm in 1s.
   * All heavy work runs in alarm() context.
   */
  async bootstrap(sourceId: string): Promise<void> {
    const existing = await this.ctx.storage.get<string>('sourceId')
    if (existing && existing !== sourceId) {
      throw new Error(`SourceActor already bound to ${existing}, refusing rebind to ${sourceId}`)
    }
    if (!existing) {
      await this.ctx.storage.put('sourceId', sourceId)
      await this.ctx.storage.put<Phase>('phase', 'generate')
    }
    // Idempotent: if an alarm is already scheduled, don't reset it.
    const current = await this.ctx.storage.getAlarm()
    if (current === null) await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  override async alarm(): Promise<void> {
    const sourceId = await this.ctx.storage.get<string>('sourceId')
    if (!sourceId) return

    const phase = (await this.ctx.storage.get<Phase>('phase')) ?? 'generate'
    try {
      switch (phase) {
        case 'generate':
          await this.runGeneration(sourceId)
          await this.ctx.storage.put<Phase>('phase', 'refresh')
          await this.ctx.storage.setAlarm(Date.now() + 1000)
          return
        case 'refresh': {
          const enqueueRegen = await this.runRefresh(sourceId)
          if (enqueueRegen) {
            await this.ctx.storage.put<Phase>('phase', 'regen')
            await this.ctx.storage.setAlarm(Date.now() + 1000)
          } else {
            await this.scheduleNextDaily()
          }
          return
        }
        case 'regen':
          await this.runRegeneration(sourceId)
          await this.ctx.storage.put<Phase>('phase', 'refresh')
          await this.scheduleNextDaily()
          return
      }
    } catch (err) {
      console.error(`SourceActor alarm failed for ${sourceId} (phase=${phase})`, err)
      await this.recordFailure(sourceId)
      // Retry in 1 hour for transient failures.
      await this.ctx.storage.setAlarm(Date.now() + 60 * 60_000)
    }
  }

  private async scheduleNextDaily(): Promise<void> {
    // Quantize to the day boundary so daily alarms don't drift.
    const next = quantizeDay(new Date()).getTime() + DAILY_MS
    await this.ctx.storage.setAlarm(next)
  }

  private async runGeneration(sourceId: string): Promise<void> {
    const db = createDbForEnv(this.env)
    const ledger = createLedger(db)
    const parsew = createParsewForEnv(this.env, ledger, { sourceId })
    const llm = createLLMForEnv(this.env, ledger, { sourceId })

    const source = await loadSource(db, sourceId)
    if (!source) throw new Error(`source ${sourceId} not found`)

    const { html } = await parsew.scrape(source.listingUrl)
    const result = await generateScraper({ html, baseUrl: source.listingUrl, llm })

    await db.insert(schema.scrapers).values({
      sourceId,
      kind: result.kind,
      config: result.kind === 'css' ? result.config : { reason: result.reason },
      version: 1,
      active: true,
      generatedByModel: result.kind === 'css' ? 'css-from-llm' : 'fallback-extract',
      lastRunStatus: 'bootstrapped',
    })
  }

  /** Returns true if regen should be enqueued. */
  private async runRefresh(sourceId: string): Promise<boolean> {
    const db = createDbForEnv(this.env)
    const ledger = createLedger(db)
    const parsew = createParsewForEnv(this.env, ledger, { sourceId })

    const source = await loadSource(db, sourceId)
    if (!source) throw new Error(`source ${sourceId} not found`)
    const stored = await loadActiveScraper(db, sourceId)
    if (!stored) throw new Error(`no active scraper for source ${sourceId}`)

    const result = await refreshSource({
      sourceId,
      listingUrl: source.listingUrl,
      language: source.language,
      scraper: stored,
      parsew,
      upsertEvents: (rows) => upsertEvents(db, rows),
    })

    await db
      .update(schema.sources)
      .set({ lastOkAt: new Date(), consecutiveFailures: 0 })
      .where(eq(schema.sources.id, sourceId))

    console.log(`source ${source.domain} refreshed: ${result.eventCount} via ${result.path}`)
    return result.fellBackToExtract && stored.kind === 'css'
  }

  private async runRegeneration(sourceId: string): Promise<void> {
    const db = createDbForEnv(this.env)
    const ledger = createLedger(db)
    const parsew = createParsewForEnv(this.env, ledger, { sourceId })
    const llm = createLLMForEnv(this.env, ledger, { sourceId })

    const source = await loadSource(db, sourceId)
    if (!source) throw new Error(`source ${sourceId} not found`)

    const { html } = await parsew.scrape(source.listingUrl)
    const result = await generateScraper({ html, baseUrl: source.listingUrl, llm })

    if (result.kind !== 'css') {
      console.log(`regen for ${sourceId} stayed on extract path`)
      return
    }

    // Two-statement no-transaction approach (per reviewer): partial unique idx
    // on (sourceId, active=true) guarantees at most one active row at a time.
    // Race-resistant via the unique (sourceId, version) constraint.
    await db
      .update(schema.scrapers)
      .set({ active: false })
      .where(and(eq(schema.scrapers.sourceId, sourceId), eq(schema.scrapers.active, true)))

    const max = await db
      .select({ v: sql<number>`coalesce(max(${schema.scrapers.version}), 0)` })
      .from(schema.scrapers)
      .where(eq(schema.scrapers.sourceId, sourceId))
    const nextVersion = (max[0]?.v ?? 0) + 1

    await db
      .insert(schema.scrapers)
      .values({
        sourceId,
        kind: 'css',
        config: result.config,
        version: nextVersion,
        active: true,
        generatedByModel: 'regenerated',
      })
      .onConflictDoNothing({ target: [schema.scrapers.sourceId, schema.scrapers.version] })
  }

  private async recordFailure(sourceId: string): Promise<void> {
    const db = createDbForEnv(this.env)
    await db
      .update(schema.sources)
      .set({ consecutiveFailures: sql`${schema.sources.consecutiveFailures} + 1` })
      .where(eq(schema.sources.id, sourceId))
  }
}

async function loadSource(db: Database, sourceId: string) {
  const [row] = await db.select().from(schema.sources).where(eq(schema.sources.id, sourceId)).limit(1)
  return row
}

async function loadActiveScraper(db: Database, sourceId: string): Promise<StoredScraper | null> {
  const [row] = await db
    .select()
    .from(schema.scrapers)
    .where(and(eq(schema.scrapers.sourceId, sourceId), eq(schema.scrapers.active, true)))
    .limit(1)
  if (!row) return null
  if (row.kind === 'css') return { kind: 'css', config: row.config as CSSScraperConfig }
  return { kind: 'extract' }
}

async function upsertEvents(db: Database, rows: EventRow[]): Promise<void> {
  if (rows.length === 0) return
  await db
    .insert(schema.events)
    .values(rows)
    .onConflictDoNothing({ target: [schema.events.sourceId, schema.events.contentHash] })
}
