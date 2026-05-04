// Inspect what the CSS-gen LLM is producing. Saves the fetched HTML + each
// attempt's selector config + sample events so we can see WHY plausibility is
// failing.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { cleanHtml, runCSSScraper, type CSSScraperConfig } from '@dolimoyo/scrapers'
import { createLLMClient } from '@dolimoyo/llm'
import { createParsewClient } from '@dolimoyo/parsew'
import { SCRAPER_GEN_SYSTEM } from '../src/pipeline/generate-scraper.ts'
import { LocalStore } from './lib/store.ts'

const cssConfigSchema = z.object({
  itemSelector: z.string().min(1),
  baseUrl: z.string().optional(),
  fields: z.object({
    title: z.string(),
    url: z.string(),
    startsAt: z.string().optional(),
    startsAtAttr: z.string().optional(),
    venueName: z.string().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    imageUrlAttr: z.string().optional(),
    priceText: z.string().optional(),
  }),
})

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      sourceId: { type: 'string' },
      url: { type: 'string' },
      maxChars: { type: 'string', default: '60000' },
      attempts: { type: 'string', default: '3' },
      waitFor: { type: 'string' },
      waitForSelector: { type: 'string' },
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
  if (!source) throw new Error('usage: debug-css --sourceId <id> | --url <url>')

  const parsew = createParsewClient({ apiKey: parsewKey, baseUrl: process.env.PARSEW_BASE_URL })
  const llmCalls: { task: string; costUSD: number; inputTokens: number; outputTokens: number }[] = []
  const llm = createLLMClient({
    apiKey: orKey,
    appName: 'dolimoyo-debug-css',
    onCall: (e) => llmCalls.push({ task: e.task, costUSD: e.costUSD, inputTokens: e.inputTokens, outputTokens: e.outputTokens }),
  })

  const outDir = resolve(import.meta.dirname, '../tmp/css-debug')
  mkdirSync(outDir, { recursive: true })
  const slug = `${source.locationKey}-${source.domain.replace(/\./g, '_')}`
  const ts = new Date().toISOString().replace(/[:.]/g, '-')

  const overrideOpts =
    values.waitFor || values.waitForSelector
      ? {
          ...(values.waitFor ? { waitFor: Number(values.waitFor) } : {}),
          ...(values.waitForSelector ? { waitForSelector: values.waitForSelector } : {}),
        }
      : source.scrapeOptions ?? undefined

  console.log(`\n→ debug CSS gen for ${source.listingUrl}`)
  if (overrideOpts) console.log(`  scrapeOptions: ${JSON.stringify(overrideOpts)}`)
  const t0 = Date.now()
  const { html, markdown, links } = await parsew.scrape(source.listingUrl, overrideOpts)
  console.log(`  fetched: ${html.length} bytes html, ${markdown?.length ?? 0} bytes markdown, ${links?.length ?? 0} links`)
  writeFileSync(resolve(outDir, `${slug}-${ts}.html`), html)

  const maxChars = Number(values.maxChars)
  const cleaned = cleanHtml(html)
  const trimmedHtml = cleaned.length > maxChars ? cleaned.slice(0, maxChars) + '\n<!-- ...truncated -->' : cleaned
  console.log(`  cleaned html: ${cleaned.length} bytes (was ${html.length}, cap ${maxChars})\n`)

  const attempts: Array<{
    n: number
    config: CSSScraperConfig | null
    eventCount: number
    sampleTitles: string[]
    error: string | null
  }> = []

  let feedback = ''
  for (let i = 1; i <= Number(values.attempts); i++) {
    console.log(`── attempt ${i} ──`)
    const prompt = [
      `Base URL: ${source.listingUrl}`,
      feedback ? `\nFeedback from previous attempt:\n${feedback}\n` : '',
      `\nHTML (script/style/svg/iframes already stripped):\n${trimmedHtml}`,
    ].join('')

    let config: CSSScraperConfig | null = null
    let eventCount = 0
    let sampleTitles: string[] = []
    let error: string | null = null
    try {
      const cfg = await llm.generateObject({
        task: 'scraperGen',
        schema: cssConfigSchema,
        system: SCRAPER_GEN_SYSTEM,
        prompt,
        maxOutputTokens: 2048,
      })
      config = { ...cfg, baseUrl: cfg.baseUrl ?? source.listingUrl }
      const r = runCSSScraper(html, config)
      eventCount = r.events.length
      sampleTitles = r.events.slice(0, 5).map((e) => e.title)
      console.log(`  itemSelector: ${config.itemSelector}`)
      console.log(`  fields: ${JSON.stringify(config.fields)}`)
      console.log(`  → ${eventCount} events`)
      if (sampleTitles.length > 0) {
        console.log(`  sample titles:`)
        for (const t of sampleTitles) console.log(`    - ${t}`)
      }
      if (eventCount < 3) {
        feedback = `Previous attempt's itemSelector="${config.itemSelector}" matched ${eventCount} elements. Look at the actual HTML class/tag names again — pick selectors visible in the HTML below.`
      } else {
        console.log(`  ✓ plausible\n`)
        attempts.push({ n: i, config, eventCount, sampleTitles, error })
        break
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      console.log(`  ⚠ ${error}`)
      feedback = `Previous attempt threw: ${error}. Return valid JSON matching the schema.`
    }
    attempts.push({ n: i, config, eventCount, sampleTitles, error })
    console.log()
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const totalCost = llmCalls.reduce((a, b) => a + b.costUSD, 0)
  const totalIn = llmCalls.reduce((a, b) => a + b.inputTokens, 0)
  const totalOut = llmCalls.reduce((a, b) => a + b.outputTokens, 0)

  const dumpPath = resolve(outDir, `${slug}-${ts}.json`)
  writeFileSync(
    dumpPath,
    JSON.stringify(
      { source, htmlBytes: html.length, attempts, elapsedSec: Number(elapsed), llmCostUSD: totalCost, llmCalls },
      null,
      2,
    ),
  )
  console.log(`elapsed: ${elapsed}s · llm $${totalCost.toFixed(4)} (${totalIn} in / ${totalOut} out tokens)`)
  console.log(`html → ${resolve(outDir, `${slug}-${ts}.html`)}`)
  console.log(`dump → ${dumpPath}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
