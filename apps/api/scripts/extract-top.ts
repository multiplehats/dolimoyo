// Extract events from the top-N sources of a given location (in-process, single
// store instance — accurate summaries, no subprocess overhead).

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { locationKey as toLocationKey } from '@dolimoyo/db'
import { createParsewClient } from '@dolimoyo/parsew'
import { extractFromSource } from './lib/extract.ts'
import { LocalStore } from './lib/store.ts'

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    allowPositionals: true,
    options: {
      location: { type: 'string' },
      n: { type: 'string', default: '5' },
      minScore: { type: 'string', default: '7' },
    },
  })
  if (!values.location) throw new Error('usage: extract-top --location <label> [--n 5] [--minScore 7]')

  const parsewKey = process.env.PARSEW_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
  const key = toLocationKey(values.location)
  const sources = store
    .listSources({ locationKey: key })
    .filter((s) => (s.discoveryScore ?? 0) >= Number(values.minScore))
    .sort((a, b) => (b.discoveryScore ?? 0) - (a.discoveryScore ?? 0))
    .slice(0, Number(values.n))

  if (sources.length === 0) {
    console.log(`No sources for "${values.location}" (key=${key}) at score ≥ ${values.minScore}.`)
    console.log(`Run \`pnpm discover --location "${values.location}" --lat ... --lng ...\` first.`)
    return
  }

  const parsew = createParsewClient({
    apiKey: parsewKey,
    baseUrl: process.env.PARSEW_BASE_URL,
  })

  console.log(`\n→ extracting top ${sources.length} sources for ${values.location}\n`)
  for (const [i, s] of sources.entries()) {
    console.log(`[${i + 1}/${sources.length}] score ${s.discoveryScore?.toFixed(1)}  ${s.listingUrl}`)
    try {
      const r = await extractFromSource({ store, source: s, parsew })
      console.log(`         → ${r.upserted.length} events (${r.perennials.length} perennial) in ${r.elapsedSec}s\n`)
    } catch (err) {
      console.log(`         ⚠ ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  const sum = store.summary()
  const loc = sum.byLocation.find((l) => l.key === key)
  if (loc) {
    const noisePct = loc.events > 0 ? ((loc.perennials / loc.events) * 100).toFixed(0) : '0'
    console.log(
      `✓ ${loc.label}: ${loc.events} events (${loc.perennials} perennial, ${noisePct}%) across ${loc.sources} sources`,
    )
    console.log(`  → ${sum.path}\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
