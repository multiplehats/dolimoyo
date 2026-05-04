import { z } from 'zod'
import { runCSSScraper, looksPlausible, type CSSScraperConfig, type ScrapedEvent } from '@dolimoyo/scrapers'
import type { ParsewClient } from '@dolimoyo/parsew'

export type StoredScraper =
  | { kind: 'css'; config: CSSScraperConfig }
  | { kind: 'extract' }

export interface EventRow {
  sourceId: string
  title: string
  url: string
  startsAt: Date
  venueName: string | null
  description: string | null
  imageUrl: string | null
  priceText: string | null
  language: string
  contentHash: string
}

export interface RefreshArgs {
  sourceId: string
  listingUrl: string
  language: string
  scraper: StoredScraper
  parsew: Pick<ParsewClient, 'scrape' | 'extract'>
  upsertEvents: (rows: EventRow[]) => Promise<void>
}

export interface RefreshResult {
  path: 'css' | 'extract'
  fellBackToExtract: boolean
  eventCount: number
}

const extractSchema = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      startsAt: z.string(),
      venueName: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      imageUrl: z.string().nullable().optional(),
      priceText: z.string().nullable().optional(),
    }),
  ),
})

export async function refreshSource(args: RefreshArgs): Promise<RefreshResult> {
  const { html } = await args.parsew.scrape(args.listingUrl)

  let events: ScrapedEvent[] = []
  let path: 'css' | 'extract' = 'css'
  let fellBack = false

  if (args.scraper.kind === 'css') {
    const r = runCSSScraper(html, args.scraper.config)
    events = r.events
    if (!looksPlausible(events)) {
      fellBack = true
      path = 'extract'
      events = await runExtract(args)
    }
  } else {
    path = 'extract'
    events = await runExtract(args)
  }

  const rows = events
    .filter((e): e is ScrapedEvent & { startsAt: Date } => e.startsAt !== null)
    .map((e) => ({
      sourceId: args.sourceId,
      title: e.title,
      url: e.url,
      startsAt: e.startsAt,
      venueName: e.venueName,
      description: e.description,
      imageUrl: e.imageUrl,
      priceText: e.priceText,
      language: args.language,
      contentHash: hashEvent(e),
    }))

  if (rows.length > 0) await args.upsertEvents(rows)
  return { path, fellBackToExtract: fellBack, eventCount: rows.length }
}

async function runExtract(args: RefreshArgs): Promise<ScrapedEvent[]> {
  const result = await args.parsew.extract(args.listingUrl, {
    schema: extractSchema,
    prompt:
      'Extract every event listing on this page. For each: title, absolute URL to detail page, ISO-8601 startsAt, venueName if present, description if present, imageUrl if present, priceText if present.',
  })
  const data = result.data as z.infer<typeof extractSchema>
  return data.events.map((e) => ({
    title: e.title,
    url: e.url,
    startsAt: parseDate(e.startsAt),
    rawStartsAt: e.startsAt,
    venueName: e.venueName ?? null,
    description: e.description ?? null,
    imageUrl: e.imageUrl ?? null,
    priceText: e.priceText ?? null,
  }))
}

function parseDate(s: string): Date | null {
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : new Date(ms)
}

function hashEvent(e: ScrapedEvent): string {
  const key = `${normalize(e.title)}|${e.startsAt?.toISOString() ?? ''}|${normalize(e.venueName ?? '')}|${e.url}`
  return fnv1a64(key)
}
function normalize(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, ' ') }
function fnv1a64(s: string): string {
  let hi = 0xcbf29ce4 | 0
  let lo = 0x84222325 | 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    lo = (lo ^ c) >>> 0
    const mulLo = Math.imul(lo, 0x100000001) >>> 0
    const mulHi = (Math.imul(hi, 0x100000001) + Math.imul(lo, 0x1b3)) >>> 0
    lo = mulLo
    hi = mulHi
  }
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0')
}
