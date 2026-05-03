// Local-iteration refresh path: CSS scraper first, fall back to Parsew Extract
// when implausible or when no CSS scraper is registered. Captures isRecurring
// in the Extract path; the CSS path defaults isRecurring=false (cheerio can't
// infer it without an LLM pass — see filter-perennials.ts for that).

import { createHash } from 'node:crypto'
import {
  looksPlausible,
  runCSSScraper,
  type CSSScraperConfig,
  type ScrapedEvent,
} from '@uitagenda/scrapers'
import type { ParsewClient } from '@uitagenda/parsew'
import { EXTRACT_PROMPT, eventsSchema } from './extract.ts'
import type { LocalStore } from './store.ts'
import type { EventRecord, ScraperRecord, SourceRecord } from './types.ts'
import { z } from 'zod'

export interface RefreshResult {
  path: 'css' | 'extract' | 'css-fallback-extract'
  upserted: EventRecord[]
  oneoffs: EventRecord[]
  perennials: EventRecord[]
  elapsedSec: number
  parsewCalls: number
  warning: string | null
  scraperStatus: ScraperRecord['lastRunStatus']
}

export async function refreshSourceLocal(args: {
  store: LocalStore
  source: SourceRecord
  scraper: ScraperRecord | null
  parsew: ParsewClient
}): Promise<RefreshResult> {
  let parsewCalls = 0
  const t0 = Date.now()

  let path: RefreshResult['path']
  let scraperStatus: ScraperRecord['lastRunStatus'] = null
  let parsedEvents: Array<{
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
  }> = []
  let warning: string | null = null

  // Try CSS first if we have an active CSS scraper.
  if (args.scraper?.kind === 'css' && args.scraper.config) {
    const { html } = await args.parsew.scrape(args.source.listingUrl)
    parsewCalls++
    const r = runCSSScraper(html, args.scraper.config as CSSScraperConfig)
    if (looksPlausible(r.events)) {
      path = 'css'
      scraperStatus = 'ok'
      parsedEvents = r.events.map(toLocalEvent)
    } else {
      // Fall back to Extract on the same URL.
      path = 'css-fallback-extract'
      scraperStatus = 'fell-back'
      parsedEvents = await runExtract(args.parsew, args.source.listingUrl).then((r) => {
        parsewCalls++
        warning = r.warning
        return r.events
      })
    }
  } else {
    path = 'extract'
    parsedEvents = await runExtract(args.parsew, args.source.listingUrl).then((r) => {
      parsewCalls++
      warning = r.warning
      return r.events
    })
  }

  const upserted = parsedEvents.map((e) => {
    const contentHash = sha1(`${e.title}|${e.startsAt ?? ''}|${e.venueName ?? ''}|${e.url}`)
    return args.store.upsertEvent({
      sourceId: args.source.id,
      title: e.title,
      url: e.url,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      venueName: e.venueName,
      description: e.description,
      imageUrl: e.imageUrl,
      priceText: e.priceText,
      isRecurring: e.isRecurring,
      recurringReason: e.recurringReason,
      language: args.source.language,
      contentHash,
    })
  })

  args.store.markSourceOk(args.source.id)
  if (args.scraper) args.store.markScraperRun(args.scraper.id, scraperStatus)
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1))

  args.store.recordExtractRun({
    sourceId: args.source.id,
    url: args.source.listingUrl,
    elapsedSec,
    parsewCalls,
    llmCostUSD: 0,
    eventCount: upserted.length,
    recurringCount: upserted.filter((e) => e.isRecurring).length,
    path,
    warning,
  })

  return {
    path,
    upserted,
    oneoffs: upserted.filter((e) => !e.isRecurring),
    perennials: upserted.filter((e) => e.isRecurring),
    elapsedSec,
    parsewCalls,
    warning,
    scraperStatus,
  }
}

function toLocalEvent(e: ScrapedEvent) {
  return {
    title: e.title,
    url: e.url,
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    endsAt: null,
    venueName: e.venueName,
    description: e.description,
    imageUrl: e.imageUrl,
    priceText: e.priceText,
    isRecurring: false,
    recurringReason: null,
  }
}

async function runExtract(
  parsew: ParsewClient,
  url: string,
): Promise<{ events: ReturnType<typeof toLocalEvent>[]; warning: string | null }> {
  const result = await parsew.extract(url, {
    schema: eventsSchema,
    prompt: EXTRACT_PROMPT,
  })
  const data = result.data as z.infer<typeof eventsSchema>
  return {
    events: data.events.map((e) => ({
      title: e.title,
      url: e.url,
      startsAt: e.startsAt && e.startsAt.trim() ? e.startsAt : null,
      endsAt: e.endsAt ?? null,
      venueName: e.venueName ?? null,
      description: e.description ?? null,
      imageUrl: e.imageUrl ?? null,
      priceText: e.priceText ?? null,
      isRecurring: e.isRecurring,
      recurringReason: e.isRecurring ? (e.recurringReason ?? null) : null,
    })),
    warning: result.warning ?? null,
  }
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16)
}
