import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createParsewClient } from '@dolimoyo/parsew'
import { extractFromSource } from './lib/extract.ts'
import { LocalStore } from './lib/store.ts'

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      sourceId: { type: 'string' },
    },
  })
  const url = values.url ?? positionals[0]
  if (!url && !values.sourceId) {
    throw new Error('usage: extract-events.ts <url> [--sourceId <id>]')
  }

  const parsewKey = process.env.PARSEW_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
  const source = values.sourceId
    ? store.getSourceById(values.sourceId)
    : url
      ? store.getSourceByUrl(url)
      : null
  if (!source) {
    throw new Error(
      `no source in local store for ${url ?? values.sourceId}. Run \`pnpm discover\` first or pass --sourceId.`,
    )
  }

  const parsew = createParsewClient({
    apiKey: parsewKey,
    baseUrl: process.env.PARSEW_BASE_URL,
  })

  console.log(`\n→ extracting events from ${source.listingUrl}`)
  console.log(`   source: ${source.id} (${source.locationLabel})\n`)

  const result = await extractFromSource({ store, source, parsew })

  console.log(`✓ ${result.upserted.length} events in ${result.elapsedSec}s (oneoff: ${result.oneoffs.length}, recurring: ${result.perennials.length})`)
  console.log(`\n— one-off events (sample) —`)
  for (const e of result.oneoffs.slice(0, 10)) {
    console.log(`  ${e.startsAt ?? '(undated)'}  ${e.title}`)
  }
  if (result.perennials.length > 0) {
    console.log(`\n— flagged as recurring/perennial (sample) —`)
    for (const e of result.perennials.slice(0, 10)) {
      console.log(`  ${e.title}  —  ${e.recurringReason ?? '(no reason)'}`)
    }
  }
  console.log(`\n→ persisted to ${store.summary().path}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
