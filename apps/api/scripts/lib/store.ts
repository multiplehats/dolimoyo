import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { locationKey as toLocationKey } from '@uitagenda/db'
import type {
  DiscoveryRun,
  EventRecord,
  ExtractRun,
  SourceRecord,
} from './types.ts'

interface StoreShape {
  sources: SourceRecord[]
  events: EventRecord[]
  discoveryRuns: DiscoveryRun[]
  extractRuns: ExtractRun[]
}

const EMPTY: StoreShape = { sources: [], events: [], discoveryRuns: [], extractRuns: [] }

export class LocalStore {
  private dir: string
  private path: string
  private data: StoreShape

  constructor(dir: string) {
    this.dir = resolve(dir)
    this.path = resolve(this.dir, 'store.json')
    mkdirSync(this.dir, { recursive: true })
    this.data = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, 'utf-8')) as StoreShape)
      : structuredClone(EMPTY)
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2))
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
    }
    this.data.sources.push(row)
    this.save()
    return row
  }

  markSourceOk(id: string): void {
    const s = this.getSourceById(id)
    if (!s) return
    s.lastOkAt = new Date().toISOString()
    s.consecutiveFailures = 0
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

  // ── runs ───────────────────────────────────────────────────────────────

  recordDiscoveryRun(r: Omit<DiscoveryRun, 'id' | 'occurredAt'>): DiscoveryRun {
    const run: DiscoveryRun = { ...r, id: randomUUID(), occurredAt: new Date().toISOString() }
    this.data.discoveryRuns.push(run)
    this.save()
    return run
  }

  recordExtractRun(r: Omit<ExtractRun, 'id' | 'occurredAt'>): ExtractRun {
    const run: ExtractRun = { ...r, id: randomUUID(), occurredAt: new Date().toISOString() }
    this.data.extractRuns.push(run)
    this.save()
    return run
  }

  // ── summary ────────────────────────────────────────────────────────────

  summary() {
    const byLocation = new Map<string, { label: string; sources: number; events: number; perennials: number }>()
    for (const s of this.data.sources) {
      const e = byLocation.get(s.locationKey) ?? {
        label: s.locationLabel,
        sources: 0,
        events: 0,
        perennials: 0,
      }
      e.sources++
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
      discoveryRuns: this.data.discoveryRuns.length,
      extractRuns: this.data.extractRuns.length,
      llmCostUSD: Number(totalLLMCost.toFixed(4)),
      parsewCalls: totalParsewCalls,
      byLocation: Array.from(byLocation.entries()).map(([k, v]) => ({ key: k, ...v })),
    }
  }
}
