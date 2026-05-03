// Plain Parsew scrape with auto-fallback to a JS-rendered scrape if the first
// response looks like an SPA shell (skeleton HTML, almost no real text).
//
// SPA sites — Next/Vue/React apps that hydrate client-side — return a sparse
// HTML body on first byte. After stripping script/style/svg the visible text
// is tiny (~hundreds of chars). Setting waitFor: 3000 tells Parsew to load
// the page in a headless browser and wait 3s for content. Costs the same
// (1 unit) but is slower (~5-8s instead of ~1s), so we only do it when needed.

import { bodyTextLength } from '@uitagenda/scrapers'
import type { ParsewClient, ScrapeResult } from '@uitagenda/parsew'
import type { ScrapeOptions } from './types.ts'

export interface ScrapeWithSpaResult extends ScrapeResult {
  // The options that produced this result. null when plain scrape sufficed.
  // Persist this back on the SourceRecord so future refreshes skip the probe.
  scrapeOptions: ScrapeOptions | null
  // True when we re-scraped with waitFor because the first attempt looked SPA-shaped.
  spaDetected: boolean
}

const SPA_TEXT_THRESHOLD = 600
const DEFAULT_WAIT_MS = 3000

export async function scrapeWithSpa(
  parsew: Pick<ParsewClient, 'scrape'>,
  url: string,
  preferred?: ScrapeOptions | null,
): Promise<ScrapeWithSpaResult> {
  // If the source already has known-good options, honor them and skip the probe.
  if (preferred && (preferred.waitFor || preferred.waitForSelector)) {
    const r = await parsew.scrape(url, preferred)
    return { ...r, scrapeOptions: preferred, spaDetected: false }
  }
  const first = await parsew.scrape(url)
  if (bodyTextLength(first.html) >= SPA_TEXT_THRESHOLD) {
    return { ...first, scrapeOptions: null, spaDetected: false }
  }
  const opts: ScrapeOptions = { waitFor: DEFAULT_WAIT_MS }
  const second = await parsew.scrape(url, opts)
  return { ...second, scrapeOptions: opts, spaDetected: true }
}
