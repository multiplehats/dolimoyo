import { createLLMClient } from '@dolimoyo/llm'
import { createParsewClient } from '@dolimoyo/parsew'
import { discoverSources } from '../../src/pipeline/discover.ts'
import type { Scenario } from './scenarios.ts'

export interface PathAResult {
  scenarioId: string
  sources: Array<{ listingUrl: string; domain: string; title: string; score: number }>
  parsewCalls: number
  parsewBreakdown: Record<string, number>
  llmCalls: Array<{ task: string; model: string; inputTokens: number; outputTokens: number; costUSD: number }>
  llmCostUSD: number
  parsewCostUSDEstimate: number
  elapsedSec: number
  error?: string
}

const PARSEW_COST_PER_CALL = {
  search: 0.005,
  map: 0.01,
  scrape: 0.005,
  extract: 0.01,
} as const

export async function runPathA(scenario: Scenario): Promise<PathAResult> {
  const parsewKey = process.env.PARSEW_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY
  if (!parsewKey) throw new Error('PARSEW_API_KEY missing')
  if (!orKey) throw new Error('OPENROUTER_API_KEY missing')

  const parsewLog: Array<{ endpoint: string; costUnits: number }> = []
  const llmLog: PathAResult['llmCalls'] = []

  const parsew = createParsewClient({
    apiKey: parsewKey,
    baseUrl: process.env.PARSEW_BASE_URL,
    onCall: (e) => parsewLog.push(e),
  })
  const llm = createLLMClient({
    apiKey: orKey,
    appName: 'dolimoyo-cma-test',
    onCall: (e) =>
      llmLog.push({
        task: e.task,
        model: e.model,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        costUSD: e.costUSD,
      }),
  })

  const t0 = Date.now()
  try {
    const sources = await discoverSources({
      location: scenario.pathA.location,
      interests: scenario.pathA.interests,
      language: scenario.pathA.language,
      topN: scenario.pathA.topN,
      parsew,
      llm,
    })
    return finalize(scenario.id, sources, parsewLog, llmLog, t0)
  } catch (err) {
    return {
      ...finalize(scenario.id, [], parsewLog, llmLog, t0),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function finalize(
  scenarioId: string,
  sources: Array<{ listingUrl: string; domain: string; title: string; score: number }>,
  parsewLog: Array<{ endpoint: string; costUnits: number }>,
  llmLog: PathAResult['llmCalls'],
  t0: number,
): PathAResult {
  const parsewBreakdown = parsewLog.reduce<Record<string, number>>((m, e) => {
    m[e.endpoint] = (m[e.endpoint] ?? 0) + 1
    return m
  }, {})
  const parsewCostUSDEstimate = parsewLog.reduce((acc, e) => {
    const rate = PARSEW_COST_PER_CALL[e.endpoint as keyof typeof PARSEW_COST_PER_CALL] ?? 0.005
    return acc + rate
  }, 0)
  return {
    scenarioId,
    sources,
    parsewCalls: parsewLog.length,
    parsewBreakdown,
    llmCalls: llmLog,
    llmCostUSD: llmLog.reduce((a, b) => a + b.costUSD, 0),
    parsewCostUSDEstimate,
    elapsedSec: (Date.now() - t0) / 1000,
  }
}
