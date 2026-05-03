// Refresh the top-N sources of a location in-process. Auto-generates CSS
// scrapers for any source that doesn't have one yet (one-time per source).

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { locationKey as toLocationKey } from '@uitagenda/db'
import { MODELS, createLLMClient } from '@uitagenda/llm'
import { createParsewClient } from '@uitagenda/parsew'
import { generateScraper } from '../src/pipeline/generate-scraper.ts'
import { refreshSourceLocal } from './lib/refresh.ts'
import { scrapeWithSpa } from './lib/scrape-with-spa.ts'
import { LocalStore } from './lib/store.ts'

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      location: { type: 'string' },
      n: { type: 'string', default: '5' },
      minScore: { type: 'string', default: '7' },
      skipGen: { type: 'boolean', default: false },
    },
  })
  if (!values.location) throw new Error('usage: refresh-top --location X [--n 5] [--minScore 7] [--skipGen]')

  const parsewKey = process.env.PARSEW_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')
  if (!orKey && !values.skipGen) throw new Error('OPENROUTER_API_KEY missing (or pass --skipGen)')

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
  const key = toLocationKey(values.location)
  const sources = store
    .listSources({ locationKey: key })
    .filter((s) => (s.discoveryScore ?? 0) >= Number(values.minScore))
    .sort((a, b) => (b.discoveryScore ?? 0) - (a.discoveryScore ?? 0))
    .slice(0, Number(values.n))
  if (sources.length === 0) {
    console.log(`No sources for "${values.location}" (key=${key}) at score ≥ ${values.minScore}.`)
    return
  }

  const parsew = createParsewClient({ apiKey: parsewKey, baseUrl: process.env.PARSEW_BASE_URL })
  const llmCalls: { task: string; costUSD: number }[] = []
  const llm = orKey
    ? createLLMClient({
        apiKey: orKey,
        appName: 'uitagenda-refresh-top',
        onCall: (e) => llmCalls.push({ task: e.task, costUSD: e.costUSD }),
      })
    : null

  console.log(`\n→ refreshing top ${sources.length} sources for ${values.location}\n`)

  for (const [i, s] of sources.entries()) {
    let scraper = store.getActiveScraper(s.id)

    // One-time CSS gen if missing.
    if (!scraper && !values.skipGen && llm) {
      console.log(`[${i + 1}/${sources.length}] gen  ${s.listingUrl}`)
      try {
        // First try with current options (initially null).
        const probe = await scrapeWithSpa(parsew, s.listingUrl, s.scrapeOptions)
        if (probe.spaDetected) {
          store.setSourceScrapeOptions(s.id, probe.scrapeOptions)
          console.log(`         ⚡ probe: empty body, persisting waitFor=${probe.scrapeOptions?.waitFor}ms`)
        }
        let result = await generateScraper({
          html: probe.html,
          baseUrl: s.listingUrl,
          llm,
          maxAttempts: 2,
          language: s.language,
        })
        // If CSS gen failed and we haven't tried JS rendering yet, retry once
        // with waitFor=3000. Many sites have plausible-looking HTML on first
        // byte but the actual event list only mounts after hydration.
        if (result.kind === 'extract' && !s.scrapeOptions) {
          console.log(`         ↻ CSS failed; retrying with waitFor=3000ms`)
          const jsScrape = await parsew.scrape(s.listingUrl, { waitFor: 3000 })
          const jsResult = await generateScraper({
            html: jsScrape.html,
            baseUrl: s.listingUrl,
            llm,
            maxAttempts: 2,
            language: s.language,
          })
          if (jsResult.kind === 'css') {
            store.setSourceScrapeOptions(s.id, { waitFor: 3000 })
            result = jsResult
            console.log(`         ⚡ JS-render unlocked CSS path`)
          }
        }
        scraper = store.insertScraper({
          sourceId: s.id,
          kind: result.kind,
          config: result.kind === 'css' ? result.config : null,
          requiresDateRescue: result.kind === 'css' ? result.requiresDateRescue : false,
          generatedByModel: MODELS.scraperGen,
        })
        const tag =
          result.kind === 'css'
            ? `css (${result.sampleEventCount} events${result.requiresDateRescue ? ', + date rescue' : ''})`
            : `extract (${result.reason})`
        console.log(`         → ${tag}`)
      } catch (err) {
        console.log(`         ⚠ gen failed: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
    }

    // Refresh.
    console.log(`[${i + 1}/${sources.length}] run  ${s.listingUrl}`)
    try {
      const r = await refreshSourceLocal({ store, source: s, scraper, parsew, llm: llm ?? undefined })
      const tag = r.path === 'css' ? '⚡ css' : r.path === 'css-fallback-extract' ? '↻ css→extract' : '○ extract'
      console.log(
        `         → ${r.upserted.length} events (${r.perennials.length} perennial) in ${r.elapsedSec}s ${tag}`,
      )
      if (r.warning) console.log(`         ⚠ ${r.warning}`)
    } catch (err) {
      console.log(`         ⚠ refresh failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    console.log()
  }

  const sum = store.summary()
  const loc = sum.byLocation.find((l) => l.key === key)
  const totalCost = llmCalls.reduce((a, b) => a + b.costUSD, 0)
  if (loc) {
    const noisePct = loc.events > 0 ? ((loc.perennials / loc.events) * 100).toFixed(0) : '0'
    console.log(
      `✓ ${loc.label}: ${loc.events} events (${loc.perennials} perennial, ${noisePct}%) · ${loc.cssScrapers}/${loc.sources} CSS · gen $${totalCost.toFixed(4)}\n`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
