import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { createParsewClient } from '@uitagenda/parsew'

const eventsSchema = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      startsAt: z.string().describe('ISO-8601 if dated, otherwise empty string'),
      endsAt: z.string().nullable().optional(),
      venueName: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      imageUrl: z.string().nullable().optional(),
      priceText: z.string().nullable().optional(),
      isRecurring: z
        .boolean()
        .describe(
          'true if the listing presents itself as ongoing/permanent or weekly/perpetual (e.g., "every Sunday", "always open", "permanent collection", "visit our church"). false for one-off dated events.',
        ),
    }),
  ),
})

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
    },
  })
  const url = values.url ?? positionals[0]
  if (!url) throw new Error('usage: extract-events.ts <url>')

  const parsewKey = process.env.PARSEW_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')

  const parsewLog: { endpoint: string }[] = []
  const parsew = createParsewClient({
    apiKey: parsewKey,
    baseUrl: process.env.PARSEW_BASE_URL,
    onCall: (e) => parsewLog.push(e),
  })

  console.log(`\n→ extracting events from ${url}\n`)
  const t0 = Date.now()
  const result = await parsew.extract(url, {
    schema: eventsSchema,
    prompt:
      'Extract every event listing on this page. For each: title; absolute URL to the detail page; ISO-8601 startsAt (or empty if undated); endsAt if present; venueName, description, imageUrl, priceText if present. Critically: set isRecurring=true for entries that are perennial/static ("permanent collection", "visit our church", "always open", weekly/recurring services), and isRecurring=false for time-bound one-off events.',
  })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  const data = result.data as z.infer<typeof eventsSchema>
  const oneoffs = data.events.filter((e) => !e.isRecurring)
  const perennials = data.events.filter((e) => e.isRecurring)

  const outDir = resolve(import.meta.dirname, '../tmp')
  mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = resolve(outDir, `extract-${ts}.json`)

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        url,
        elapsedSec: Number(elapsed),
        parsewCalls: parsewLog.length,
        warning: result.warning,
        counts: {
          total: data.events.length,
          oneoff: oneoffs.length,
          recurring: perennials.length,
        },
        events: data.events,
      },
      null,
      2,
    ),
  )

  console.log(`✓ ${data.events.length} events in ${elapsed}s (oneoff: ${oneoffs.length}, recurring: ${perennials.length})`)
  console.log(`\n— one-off events (sample) —`)
  for (const e of oneoffs.slice(0, 8)) {
    console.log(`  ${e.startsAt || '(undated)'}  ${e.title}`)
  }
  if (perennials.length > 0) {
    console.log(`\n— flagged as recurring/perennial (sample) —`)
    for (const e of perennials.slice(0, 8)) {
      console.log(`  ${e.title}`)
    }
  }
  console.log(`\nfull output → ${outPath}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
