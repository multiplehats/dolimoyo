import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { locationKey } from '@uitagenda/db'
import { createLLMClient } from '@uitagenda/llm'
import { createParsewClient } from '@uitagenda/parsew'
import { discoverSources } from '../src/pipeline/discover.ts'
import { LocalStore } from './lib/store.ts'

interface ParsewLog { endpoint: string; costUnits: number }
interface LLMLog { task: string; model: string; inputTokens: number; outputTokens: number; costUSD: number }

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      location: { type: 'string', default: 'Enschede' },
      lat: { type: 'string', default: '52.2215' },
      lng: { type: 'string', default: '6.8937' },
      interests: { type: 'string', default: 'music,arts,food,festival' },
      language: { type: 'string', default: 'nl' },
      topN: { type: 'string', default: '8' },
      radiusKm: { type: 'string', default: '25' },
      nearbyAreas: { type: 'string' },
    },
  })

  const parsewKey = process.env.PARSEW_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')
  if (!orKey) throw new Error('OPENROUTER_API_KEY missing')

  const parsewLog: ParsewLog[] = []
  const llmLog: LLMLog[] = []
  const parsew = createParsewClient({
    apiKey: parsewKey,
    baseUrl: process.env.PARSEW_BASE_URL,
    onCall: (e) => parsewLog.push(e),
  })
  const llm = createLLMClient({
    apiKey: orKey,
    appName: 'uitagenda-discover-script',
    onCall: (e) => llmLog.push({
      task: e.task, model: e.model,
      inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUSD: e.costUSD,
    }),
  })

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))

  const args = {
    location: {
      label: values.location!,
      lat: Number(values.lat),
      lng: Number(values.lng),
      radiusKm: Number(values.radiusKm),
    },
    interests: values.interests!.split(',').map((s) => s.trim()).filter(Boolean),
    language: values.language!,
    topN: Number(values.topN),
    nearbyAreas: values.nearbyAreas
      ? values.nearbyAreas.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    parsew,
    llm,
  }

  console.log(`\n→ discovering sources for "${args.location.label}" (${args.interests.join(', ')})\n`)
  const t0 = Date.now()
  const sources = await discoverSources(args)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const elapsedSec = Number(elapsed)

  const totalParsewCalls = parsewLog.length
  const totalLLMCost = llmLog.reduce((a, b) => a + b.costUSD, 0)
  const parsewBreakdown = parsewLog.reduce<Record<string, number>>((m, e) => {
    m[e.endpoint] = (m[e.endpoint] ?? 0) + 1
    return m
  }, {})

  const sourceIds: string[] = []
  for (const s of sources) {
    const row = store.upsertSource({
      domain: s.domain,
      listingUrl: s.listingUrl,
      locationLabel: args.location.label,
      locationLat: args.location.lat,
      locationLng: args.location.lng,
      locationRadiusKm: args.location.radiusKm,
      language: args.language,
      discoveryScore: s.score,
    })
    sourceIds.push(row.id)
  }

  const run = store.recordDiscoveryRun({
    args: {
      location: args.location.label,
      locationKey: locationKey(args.location.label),
      lat: args.location.lat,
      lng: args.location.lng,
      radiusKm: args.location.radiusKm,
      interests: args.interests,
      language: args.language,
      topN: args.topN,
    },
    elapsedSec,
    parsewCalls: totalParsewCalls,
    parsewBreakdown,
    llmCostUSD: Number(totalLLMCost.toFixed(4)),
    llmCalls: llmLog,
    sourceIds,
  })

  // backfill discoveryRunIds on each source — second pass since we needed the run id
  for (const id of sourceIds) {
    const src = store.getSourceById(id)
    if (src && !src.discoveryRunIds.includes(run.id)) {
      store.upsertSource({
        domain: src.domain,
        listingUrl: src.listingUrl,
        locationLabel: src.locationLabel,
        locationLat: src.locationLat,
        locationLng: src.locationLng,
        locationRadiusKm: src.locationRadiusKm,
        language: src.language,
        discoveryRunId: run.id,
      })
    }
  }

  console.log(`✓ ${sources.length} sources in ${elapsed}s | parsew: ${totalParsewCalls} calls | llm: $${totalLLMCost.toFixed(4)}`)
  for (const s of sources) {
    console.log(`  ${s.score.toFixed(1)}  ${s.listingUrl}`)
  }
  console.log(`\n→ persisted to ${store.summary().path}`)
  console.log(`  run id: ${run.id}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
