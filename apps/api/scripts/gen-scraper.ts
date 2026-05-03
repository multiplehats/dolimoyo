import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { MODELS, createLLMClient } from '@uitagenda/llm'
import { createParsewClient } from '@uitagenda/parsew'
import { generateScraper } from '../src/pipeline/generate-scraper.ts'
import { scrapeWithSpa } from './lib/scrape-with-spa.ts'
import { LocalStore } from './lib/store.ts'

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      sourceId: { type: 'string' },
      url: { type: 'string' },
      force: { type: 'boolean', default: false },
      maxAttempts: { type: 'string', default: '2' },
    },
  })

  const parsewKey = process.env.PARSEW_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')
  if (!orKey) throw new Error('OPENROUTER_API_KEY missing')

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
  const source = values.sourceId
    ? store.getSourceById(values.sourceId)
    : values.url
      ? store.getSourceByUrl(values.url)
      : null
  if (!source) throw new Error('usage: gen-scraper --sourceId <id> | --url <listingUrl>')

  const existing = store.getActiveScraper(source.id)
  if (existing && !values.force) {
    console.log(`source ${source.id} already has an active ${existing.kind} scraper (v${existing.version}). Pass --force to regenerate.`)
    return
  }

  const parsew = createParsewClient({ apiKey: parsewKey, baseUrl: process.env.PARSEW_BASE_URL })
  const llmCalls: { task: string; costUSD: number }[] = []
  const llm = createLLMClient({
    apiKey: orKey,
    appName: 'uitagenda-gen-scraper',
    onCall: (e) => llmCalls.push({ task: e.task, costUSD: e.costUSD }),
  })

  console.log(`\n→ generating CSS scraper for ${source.listingUrl}\n`)
  const t0 = Date.now()
  const probe = await scrapeWithSpa(parsew, source.listingUrl, source.scrapeOptions)
  if (probe.spaDetected) {
    store.setSourceScrapeOptions(source.id, probe.scrapeOptions)
    console.log(`  ⚡ SPA detected — persisting waitFor=${probe.scrapeOptions?.waitFor}ms`)
  }
  let html = probe.html
  console.log(`  fetched ${html.length} bytes of HTML`)

  let result = await generateScraper({
    html,
    baseUrl: source.listingUrl,
    llm,
    maxAttempts: Number(values.maxAttempts),
    language: source.language,
  })
  // CSS-gen failsafe: if structural gen failed and we haven't paid for a
  // JS-rendered scrape yet, try one more time with waitFor=3000.
  if (result.kind === 'extract' && !source.scrapeOptions) {
    console.log(`  ↻ CSS failed; retrying with waitFor=3000ms`)
    const jsScrape = await parsew.scrape(source.listingUrl, { waitFor: 3000 })
    html = jsScrape.html
    const jsResult = await generateScraper({
      html,
      baseUrl: source.listingUrl,
      llm,
      maxAttempts: Number(values.maxAttempts),
      language: source.language,
    })
    if (jsResult.kind === 'css') {
      store.setSourceScrapeOptions(source.id, { waitFor: 3000 })
      result = jsResult
      console.log(`  ⚡ JS-render unlocked CSS path`)
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const totalCost = llmCalls.reduce((a, b) => a + b.costUSD, 0)

  if (result.kind === 'css') {
    const scraper = store.insertScraper({
      sourceId: source.id,
      kind: 'css',
      config: result.config,
      requiresDateRescue: result.requiresDateRescue,
      generatedByModel: MODELS.scraperGen,
    })
    console.log(`\n✓ CSS config generated and validated against ${result.sampleEventCount} sample events`)
    console.log(`  scraper id: ${scraper.id}  (v${scraper.version})`)
    console.log(`  itemSelector: ${result.config.itemSelector}`)
    console.log(`  fields: ${Object.keys(result.config.fields).join(', ')}`)
    if (result.requiresDateRescue) console.log(`  ⚡ requires date-rescue pass on every refresh`)
  } else {
    const scraper = store.insertScraper({
      sourceId: source.id,
      kind: 'extract',
      config: null,
      generatedByModel: MODELS.scraperGen,
    })
    console.log(`\n⚠ CSS generation failed; falling back to Parsew Extract path`)
    console.log(`  reason: ${result.reason}`)
    console.log(`  scraper id: ${scraper.id}  (v${scraper.version}, kind=extract)`)
  }
  console.log(`  elapsed: ${elapsed}s  llm: $${totalCost.toFixed(4)}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
