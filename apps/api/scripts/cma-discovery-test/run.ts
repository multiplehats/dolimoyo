import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { SCENARIOS, type Scenario } from './scenarios.ts'
import { runPathA, type PathAResult } from './pathA.ts'
import { createClient, setupAgentAndEnv, runPathB, SYSTEM_PROMPT, type PathBResult } from './pathB.ts'

const RESULTS_DIR = resolve(import.meta.dirname, 'results')
const PATH_B_TIMEOUT_MS = 5 * 60 * 1000

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const onlyScenario = process.env.SCENARIO
  const onlyPath = process.env.PATH_ONLY as 'A' | 'B' | undefined

  const wanted = onlyScenario
    ? new Set(onlyScenario.split(',').map((s) => s.trim()).filter(Boolean))
    : null
  const scenarios = wanted ? SCENARIOS.filter((s) => wanted.has(s.id)) : SCENARIOS
  if (scenarios.length === 0) {
    throw new Error(`No scenarios match SCENARIO=${onlyScenario}`)
  }

  console.log(`\n→ Running ${scenarios.length} scenario(s); pathOnly=${onlyPath ?? 'both'}\n`)

  let setup: Awaited<ReturnType<typeof setupAgentAndEnv>> | null = null
  if (onlyPath !== 'A') {
    const client = createClient()
    console.log('• Creating shared agent + environment (Path B)…')
    setup = await setupAgentAndEnv(client, SYSTEM_PROMPT)
    console.log(`  agent=${setup.agentId} env=${setup.environmentId}\n`)
  }

  for (const scenario of scenarios) {
    console.log(`════ ${scenario.label} (${scenario.id}) ════`)

    if (onlyPath !== 'B') {
      console.log('  [A] running current pipeline…')
      const a = await safeRun<PathAResult>(() => runPathA(scenario))
      logA(a, scenario)
      writeJson(`${scenario.id}.pathA.json`, a)
    }

    if (onlyPath !== 'A' && setup) {
      console.log('  [B] running managed agent (timeout 5m)…')
      const b = await safeRun<PathBResult>(() => runPathB(setup!, scenario, { timeoutMs: PATH_B_TIMEOUT_MS }))
      logB(b)
      writeJson(`${scenario.id}.pathB.json`, b)
    }
    console.log('')
  }

  if (setup) {
    writeJson('_handles.json', {
      agentId: setup.agentId,
      agentVersion: setup.agentVersion,
      environmentId: setup.environmentId,
    })
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

function logA(r: PathAResult | { error: string }, scenario: Scenario) {
  if ('error' in r && !('sources' in r)) {
    console.log(`     ✗ error: ${r.error}`)
    return
  }
  const a = r as PathAResult
  console.log(
    `     ✓ ${a.sources.length} sources in ${a.elapsedSec.toFixed(1)}s | parsew=${a.parsewCalls} (≈$${a.parsewCostUSDEstimate.toFixed(4)}) | llm=$${a.llmCostUSD.toFixed(4)}`,
  )
  for (const s of a.sources) {
    console.log(`       ${s.score.toFixed(1)}  ${s.listingUrl}`)
  }
  if (a.sources.length === 0 && a.parsewCalls === 0) {
    console.log(`     (note: scenario=${scenario.id} produced no sources)`)
  }
}

function logB(r: PathBResult | { error: string }) {
  if ('error' in r && !('candidates' in r)) {
    console.log(`     ✗ error: ${r.error}`)
    return
  }
  const b = r as PathBResult
  console.log(
    `     ✓ ${b.candidates.length} candidates in ${b.elapsedSec.toFixed(1)}s | tools=${b.toolUses.length} | finish=${b.finishedReason}${b.error ? ` (err: ${b.error.slice(0, 120)})` : ''}`,
  )
  for (const c of b.candidates) {
    console.log(`       ${c.url}`)
  }
}

function writeJson(name: string, obj: unknown) {
  const path = resolve(RESULTS_DIR, name)
  writeFileSync(path, JSON.stringify(obj, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
