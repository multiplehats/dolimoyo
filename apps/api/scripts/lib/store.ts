import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { locationKey as toLocationKey } from '@uitagenda/db'
import type {
  DiscoveryRun,
  EventRecord,
  ExtractRun,
  ScrapeOptions,
  ScraperRecord,
  SourceRecord,
} from './types.ts'

interface StoreShape {
  sources: SourceRecord[]
  events: EventRecord[]
  scrapers: ScraperRecord[]
  discoveryRuns: DiscoveryRun[]
  extractRuns: ExtractRun[]
}

const EMPTY: StoreShape = {
  sources: [],
  events: [],
  scrapers: [],
  discoveryRuns: [],
  extractRuns: [],
}

export class LocalStore {
  private dir: string
  private path: string
  private data: StoreShape

  constructor(dir: string) {
    this.dir = resolve(dir)
    this.path = resolve(this.dir, 'store.json')
    mkdirSync(this.dir, { recursive: true })
    this.data = structuredClone(EMPTY)
    this.reload()
  }

  // Re-read the store file before each mutation. Two processes hitting the
  // store concurrently (e.g. discovering different cities in parallel) would
  // otherwise lose updates: each loads at start, mutates in memory, and the
  // last writer overwrites the other's changes. With reload-before-mutate,
  // mutations on disjoint records (different sources / events / runs) merge
  // safely on disk. Mutations on the *same* record still race, but our
  // workflow doesn't do that.
  private reload(): void {
    if (!existsSync(this.path)) return
    const loaded = JSON.parse(readFileSync(this.path, 'utf-8')) as Partial<StoreShape>
    this.data = { ...structuredClone(EMPTY), ...loaded }
    // Backfill scrapeOptions on sources persisted before this field existed.
    for (const s of this.data.sources) {
      if (!('scrapeOptions' in s)) (s as SourceRecord).scrapeOptions = null
    }
  }

  // Write atomically: temp file + rename. Avoids partial writes on crash.
  private save(): void {
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.path)
  }

  // ── sources ────────────────────────────────────────────────────────────

  listSources(filter?: { locationKey?: string; status?: SourceRecord['status'] }): SourceRecord[] {
    return this.data.sources.filter((s) => {
      if (filter?.locationKey && s.locationKey !== filter.locationKey) return false
      if (filter?.status && s.status !== filter.status) return false
      return true
    })
  }

  getSourceById(id: string): SourceRecord | null {
    return this.data.sources.find((s) => s.id === id) ?? null
  }

  getSourceByUrl(listingUrl: string): SourceRecord | null {
    return this.data.sources.find((s) => s.listingUrl === listingUrl) ?? null
  }

  upsertSource(input: {
    domain: string
    listingUrl: string
    locationLabel: string
    locationLat: number
    locationLng: number
    locationRadiusKm?: number
    language?: string
    discoveryScore?: number | null
    discoveryRunId?: string
  }): SourceRecord {
    this.reload()
    const existing = this.getSourceByUrl(input.listingUrl)
    const locationKey = toLocationKey(input.locationLabel)
    if (existing) {
      if (input.discoveryScore != null) existing.discoveryScore = input.discoveryScore
      if (input.discoveryRunId && !existing.discoveryRunIds.includes(input.discoveryRunId)) {
        existing.discoveryRunIds.push(input.discoveryRunId)
      }
      this.save()
      return existing
    }
    const row: SourceRecord = {
      id: randomUUID(),
      domain: input.domain,
      listingUrl: input.listingUrl,
      locationLabel: input.locationLabel,
      locationKey,
      locationLat: input.locationLat,
      locationLng: input.locationLng,
      locationRadiusKm: input.locationRadiusKm ?? 25,
      language: input.language ?? 'nl',
      status: 'active',
      discoveredAt: new Date().toISOString(),
      lastOkAt: null,
      consecutiveFailures: 0,
      discoveryScore: input.discoveryScore ?? null,
      discoveryRunIds: input.discoveryRunId ? [input.discoveryRunId] : [],
      scrapeOptions: null,
    }
    this.data.sources.push(row)
    this.save()
    return row
  }

  markSourceOk(id: string): void {
    this.reload()
    const s = this.getSourceById(id)
    if (!s) return
    s.lastOkAt = new Date().toISOString()
    s.consecutiveFailures = 0
    this.save()
  }

  setSourceScrapeOptions(id: string, opts: ScrapeOptions | null): void {
    this.reload()
    const s = this.getSourceById(id)
    if (!s) return
    s.scrapeOptions = opts
    this.save()
  }

  // ── events ─────────────────────────────────────────────────────────────

  listEvents(filter?: {
    sourceId?: string
    locationKey?: string
    isRecurring?: boolean
    fromDate?: Date
    toDate?: Date
  }): EventRecord[] {
    const sourceLocByid = new Map(this.data.sources.map((s) => [s.id, s.locationKey]))
    return this.data.events.filter((e) => {
      if (filter?.sourceId && e.sourceId !== filter.sourceId) return false
      if (filter?.isRecurring != null && e.isRecurring !== filter.isRecurring) return false
      if (filter?.locationKey) {
        const loc = sourceLocByid.get(e.sourceId)
        if (loc !== filter.locationKey) return false
      }
      if (filter?.fromDate && e.startsAt && new Date(e.startsAt) < filter.fromDate) return false
      if (filter?.toDate && e.startsAt && new Date(e.startsAt) > filter.toDate) return false
      return true
    })
  }

  upsertEvent(e: Omit<EventRecord, 'id' | 'fetchedAt'>): EventRecord {
    this.reload()
    const existing = this.data.events.find(
      (x) => x.sourceId === e.sourceId && x.contentHash === e.contentHash,
    )
    if (existing) {
      Object.assign(existing, e)
      this.save()
      return existing
    }
    const row: EventRecord = {
      ...e,
      id: randomUUID(),
      fetchedAt: new Date().toISOString(),
    }
    this.data.events.push(row)
    this.save()
    return row
  }

  // ── scrapers ───────────────────────────────────────────────────────────

  getActiveScraper(sourceId: string): ScraperRecord | null {
    return this.data.scrapers.find((s) => s.sourceId === sourceId && s.active) ?? null
  }

  listScrapersForSource(sourceId: string): ScraperRecord[] {
    return this.data.scrapers
      .filter((s) => s.sourceId === sourceId)
      .sort((a, b) => b.version - a.version)
  }

  insertScraper(input: {
    sourceId: string
    kind: ScraperRecord['kind']
    config: unknown
    requiresDateRescue?: boolean
    generatedByModel?: string | null
  }): ScraperRecord {
    this.reload()
    // Mirror the partial unique index (active=true) — at most one active per source.
    for (const s of this.data.scrapers) {
      if (s.sourceId === input.sourceId && s.active) s.active = false
    }
    const previousVersions = this.data.scrapers
      .filter((s) => s.sourceId === input.sourceId)
      .map((s) => s.version)
    const version = previousVersions.length > 0 ? Math.max(...previousVersions) + 1 : 1
    const row: ScraperRecord = {
      id: randomUUID(),
      sourceId: input.sourceId,
      kind: input.kind,
      config: input.config,
      requiresDateRescue: input.requiresDateRescue ?? false,
      version,
      active: true,
      generatedByModel: input.generatedByModel ?? null,
      generatedAt: new Date().toISOString(),
      lastRunAt: null,
      lastRunStatus: null,
    }
    this.data.scrapers.push(row)
    this.save()
    return row
  }

  markScraperRun(id: string, status: ScraperRecord['lastRunStatus']): void {
    this.reload()
    const s = this.data.scrapers.find((x) => x.id === id)
    if (!s) return
    s.lastRunAt = new Date().toISOString()
    s.lastRunStatus = status
    this.save()
  }

  // ── runs ───────────────────────────────────────────────────────────────

  recordDiscoveryRun(r: Omit<DiscoveryRun, 'id' | 'occurredAt'>): DiscoveryRun {
    this.reload()
    const run: DiscoveryRun = { ...r, id: randomUUID(), occurredAt: new Date().toISOString() }
    this.data.discoveryRuns.push(run)
    this.save()
    return run
  }

  recordExtractRun(r: Omit<ExtractRun, 'id' | 'occurredAt'>): ExtractRun {
    this.reload()
    const run: ExtractRun = { ...r, id: randomUUID(), occurredAt: new Date().toISOString() }
    this.data.extractRuns.push(run)
    this.save()
    return run
  }

  // ── summary ────────────────────────────────────────────────────────────

  summary() {
    const cssBySource = new Set(
      this.data.scrapers.filter((s) => s.active && s.kind === 'css').map((s) => s.sourceId),
    )
    const byLocation = new Map<
      string,
      { label: string; sources: number; cssScrapers: number; events: number; perennials: number }
    >()
    for (const s of this.data.sources) {
      const e = byLocation.get(s.locationKey) ?? {
        label: s.locationLabel,
        sources: 0,
        cssScrapers: 0,
        events: 0,
        perennials: 0,
      }
      e.sources++
      if (cssBySource.has(s.id)) e.cssScrapers++
      byLocation.set(s.locationKey, e)
    }
    const sourceLocByid = new Map(this.data.sources.map((s) => [s.id, s.locationKey]))
    for (const ev of this.data.events) {
      const key = sourceLocByid.get(ev.sourceId)
      if (!key) continue
      const e = byLocation.get(key)
      if (!e) continue
      e.events++
      if (ev.isRecurring) e.perennials++
    }

    const totalLLMCost =
      this.data.discoveryRuns.reduce((a, b) => a + b.llmCostUSD, 0) +
      this.data.extractRuns.reduce((a, b) => a + b.llmCostUSD, 0)
    const totalParsewCalls =
      this.data.discoveryRuns.reduce((a, b) => a + b.parsewCalls, 0) +
      this.data.extractRuns.reduce((a, b) => a + b.parsewCalls, 0)

    return {
      path: this.path,
      sources: this.data.sources.length,
      events: this.data.events.length,
      activeScrapers: this.data.scrapers.filter((s) => s.active).length,
      cssScrapers: this.data.scrapers.filter((s) => s.active && s.kind === 'css').length,
      discoveryRuns: this.data.discoveryRuns.length,
      extractRuns: this.data.extractRuns.length,
      llmCostUSD: Number(totalLLMCost.toFixed(4)),
      parsewCalls: totalParsewCalls,
      byLocation: Array.from(byLocation.entries()).map(([k, v]) => ({ key: k, ...v })),
    }
  }
}
