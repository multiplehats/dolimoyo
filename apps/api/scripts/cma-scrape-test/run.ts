import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCRAPE_SCENARIOS, type ScrapeScenario } from './scenarios.ts'
import { runPathA, type PathAResult } from './pathA.ts'
import { createClient, runPathB, setupAgentAndEnv, type PathBResult } from './pathB.ts'

const RESULTS_DIR = resolve(import.meta.dirname, 'results')
const PATH_B_TIMEOUT_MS = 3 * 60 * 1000 // 3 min per URL — scraping is one-shot, not research

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const onlyScenario = process.env.SCENARIO
  const onlyPath = process.env.PATH_ONLY as 'A' | 'B' | undefined

  const wanted = onlyScenario
    ? new Set(onlyScenario.split(',').map((s) => s.trim()).filter(Boolean))
    : null
  const scenarios = wanted ? SCRAPE_SCENARIOS.filter((s) => wanted.has(s.id)) : SCRAPE_SCENARIOS
  if (scenarios.length === 0) {
    throw new Error(`No scenarios match SCENARIO=${onlyScenario}`)
  }

  console.log(`\n→ Running ${scenarios.length} scenario(s); pathOnly=${onlyPath ?? 'both'}\n`)

  let setup: Awaited<ReturnType<typeof setupAgentAndEnv>> | null = null
  if (onlyPath !== 'A') {
    const client = createClient()
    console.log('• Creating shared agent + environment (Path B)…')
    setup = await setupAgentAndEnv(client)
    console.log(`  agent=${setup.agentId} env=${setup.environmentId}\n`)
  }

  for (const scenario of scenarios) {
    console.log(`════ ${scenario.label} (${scenario.id}) ════`)
    console.log(`     ${scenario.url}`)
    console.log(`     ${scenario.notes}`)

    if (onlyPath !== 'B') {
      console.log('  [A] parsew.extract…')
      const a = await safeRun<PathAResult>(() => runPathA(scenario))
      logA(a)
      writeJson(`${scenario.id}.pathA.json`, a)
    }

    if (onlyPath !== 'A' && setup) {
      console.log('  [B] CMA agent…')
      const b = await safeRun<PathBResult>(() =>
        runPathB(setup!, scenario, { timeoutMs: PATH_B_TIMEOUT_MS }),
      )
      logB(b)
      writeJson(`${scenario.id}.pathB.json`, b)
    }
    console.log('')
  }

  if (setup) {
    writeJson('_handles.json', { agentId: setup.agentId, environmentId: setup.environmentId })
  }
  console.log(`✓ All done. Results in ${RESULTS_DIR}\n`)
}

async function safeRun<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) }
  }
}

function logA(r: PathAResult | { error: string }) {
  if ('error' in r && !('itemCount' in r)) {
    console.log(`     ✗ error: ${r.error}`)
    return
  }
  const a = r as PathAResult
  console.log(
    `     ${a.itemCount > 0 ? '✓' : '⚠'} items=${a.itemCount}  ${a.elapsedSec.toFixed(1)}s  parsew=${a.parsewCalls} (≈$${a.parsewCostUSDEstimate.toFixed(4)})${a.error ? `  err=${a.error.slice(0, 80)}` : ''}`,
  )
  for (const t of a.sampleTitles) console.log(`         • ${t.slice(0, 100)}`)
}

function logB(r: PathBResult | { error: string }) {
  if ('error' in r && !('itemCount' in r)) {
    console.log(`     ✗ error: ${r.error}`)
    return
  }
  const b = r as PathBResult
  console.log(
    `     ${b.itemCount > 0 ? '✓' : '⚠'} items=${b.itemCount}  ${b.elapsedSec.toFixed(1)}s  tools=${b.toolUses}  finish=${b.finishedReason}${b.error ? `  err=${b.error.slice(0, 80)}` : ''}`,
  )
  for (const t of b.sampleTitles) console.log(`         • ${t.slice(0, 100)}`)
}

function writeJson(name: string, obj: unknown) {
  writeFileSync(resolve(RESULTS_DIR, name), JSON.stringify(obj, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
