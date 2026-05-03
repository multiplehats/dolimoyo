import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createParsewClient } from '@uitagenda/parsew'
import { refreshSourceLocal } from './lib/refresh.ts'
import { LocalStore } from './lib/store.ts'

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      sourceId: { type: 'string' },
      url: { type: 'string' },
    },
  })

  const parsewKey = process.env.PARSEW_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
  const source = values.sourceId
    ? store.getSourceById(values.sourceId)
    : values.url
      ? store.getSourceByUrl(values.url)
      : null
  if (!source) throw new Error('usage: refresh --sourceId <id> | --url <listingUrl>')

  const scraper = store.getActiveScraper(source.id)
  const parsew = createParsewClient({ apiKey: parsewKey, baseUrl: process.env.PARSEW_BASE_URL })

  console.log(`\n→ refreshing ${source.listingUrl}`)
  console.log(`   path: ${scraper ? `${scraper.kind} (v${scraper.version})` : 'extract (no scraper)'}\n`)
  const r = await refreshSourceLocal({ store, source, scraper, parsew })

  console.log(`✓ ${r.upserted.length} events in ${r.elapsedSec}s via ${r.path}`)
  console.log(`  one-off: ${r.oneoffs.length} · perennial: ${r.perennials.length} · parsew calls: ${r.parsewCalls}`)
  if (r.warning) console.log(`  ⚠ ${r.warning}`)
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
