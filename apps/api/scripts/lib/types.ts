// Mirrors packages/db/src/schema.ts field-for-field. Swap LocalStore for a
// Drizzle-backed store later without changing call sites.

export interface SourceRecord {
  id: string
  domain: string
  listingUrl: string
  locationLabel: string
  locationKey: string
  locationLat: number
  locationLng: number
  locationRadiusKm: number
  language: string
  status: 'active' | 'broken' | 'dead'
  discoveredAt: string
  lastOkAt: string | null
  consecutiveFailures: number
  discoveryScore: number | null
  discoveryRunIds: string[]
}

export interface EventRecord {
  id: string
  sourceId: string
  title: string
  url: string
  startsAt: string | null
  endsAt: string | null
  venueName: string | null
  description: string | null
  imageUrl: string | null
  priceText: string | null
  isRecurring: boolean
  recurringReason: string | null
  language: string
  contentHash: string
  fetchedAt: string
}

export interface DiscoveryRun {
  id: string
  occurredAt: string
  args: {
    location: string
    locationKey: string
    lat: number
    lng: number
    radiusKm: number
    interests: string[]
    language: string
    topN: number
  }
  elapsedSec: number
  parsewCalls: number
  parsewBreakdown: Record<string, number>
  llmCostUSD: number
  llmCalls: { task: string; model: string; inputTokens: number; outputTokens: number; costUSD: number }[]
  sourceIds: string[]
}

export interface ExtractRun {
  id: string
  sourceId: string
  occurredAt: string
  url: string
  elapsedSec: number
  parsewCalls: number
  llmCostUSD: number
  eventCount: number
  recurringCount: number
  path: 'css' | 'extract' | 'css-fallback-extract'
  warning: string | null
}

export interface ScraperRecord {
  id: string
  sourceId: string
  kind: 'css' | 'extract'
  // CSSScraperConfig when kind='css'; null when kind='extract'.
  // Stored as `unknown` here to avoid an import cycle with @uitagenda/scrapers.
  config: unknown
  version: number
  active: boolean
  generatedByModel: string | null
  generatedAt: string
  lastRunAt: string | null
  lastRunStatus: 'ok' | 'fell-back' | 'failed' | null
}
