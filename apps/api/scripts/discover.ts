import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createLLMClient } from '@uitagenda/llm'
import { createParsewClient } from '@uitagenda/parsew'
import { discoverSources } from '../src/pipeline/discover.ts'

interface ParsewLog { endpoint: string; costUnits: number }
interface LLMLog { task: string; model: string; inputTokens: number; outputTokens: number; costUSD: number }

async function main() {
  const { values } = parseArgs({
    options: {
      location: { type: 'string', default: 'Enschede' },
      lat: { type: 'string', default: '52.2215' },
      lng: { type: 'string', default: '6.8937' },
      interests: { type: 'string', default: 'music,arts,food,festival' },
      language: { type: 'string', default: 'nl' },
      topN: { type: 'string', default: '8' },
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

  const args = {
    location: {
      label: values.location!,
      lat: Number(values.lat),
      lng: Number(values.lng),
      radiusKm: 25,
    },
    interests: values.interests!.split(',').map((s) => s.trim()).filter(Boolean),
    language: values.language!,
    topN: Number(values.topN),
    parsew,
    llm,
  }

  console.log(`\n→ discovering sources for "${args.location.label}" (${args.interests.join(', ')})\n`)
  const t0 = Date.now()
  const sources = await discoverSources(args)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  const outDir = resolve(import.meta.dirname, '../tmp')
  mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = resolve(outDir, `discover-${ts}.json`)

  const totalParsewCalls = parsewLog.length
  const totalLLMCost = llmLog.reduce((a, b) => a + b.costUSD, 0)

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        args: {
          location: args.location,
          interests: args.interests,
          language: args.language,
          topN: args.topN,
        },
        elapsedSec: Number(elapsed),
        parsewCalls: totalParsewCalls,
        llmCostUSD: Number(totalLLMCost.toFixed(4)),
        llmCalls: llmLog,
        parsewBreakdown: parsewLog.reduce<Record<string, number>>((m, e) => {
          m[e.endpoint] = (m[e.endpoint] ?? 0) + 1
          return m
        }, {}),
        sources,
      },
      null,
      2,
    ),
  )

  console.log(`✓ ${sources.length} sources in ${elapsed}s | parsew: ${totalParsewCalls} calls | llm: $${totalLLMCost.toFixed(4)}`)
  for (const s of sources) {
    console.log(`  ${s.score.toFixed(1)}  ${s.listingUrl}`)
  }
  console.log(`\nfull output → ${outPath}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
