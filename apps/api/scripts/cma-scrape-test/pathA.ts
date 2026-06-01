import { z } from 'zod'
import { createParsewClient } from '@dolimoyo/parsew'
import type { ScrapeScenario } from './scenarios.ts'
import { EXTRACT_PROMPT } from './scenarios.ts'

const eventsSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        startsAt: z.string().nullable().optional(),
        venueName: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .describe('every event listing on the page'),
})
const jobsSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        companyName: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        postedAt: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .describe('every job listing on the page'),
})

export interface PathAResult {
  scenarioId: string
  itemCount: number
  sampleTitles: string[]
  elapsedSec: number
  parsewCalls: number
  parsewCostUSDEstimate: number
  error?: string
}

const COST_PER_EXTRACT = 0.025 // parsew extract is roughly 5x scrape; ~$0.025/call from observed billing

export async function runPathA(scenario: ScrapeScenario): Promise<PathAResult> {
  const t0 = Date.now()
  let parsewCalls = 0
  const parsew = createParsewClient({
    apiKey: process.env.PARSEW_API_KEY!,
    onCall: () => {
      parsewCalls++
    },
  })

  const schema = scenario.kind === 'events' ? eventsSchema : jobsSchema

  try {
    const result = await parsew.extract(scenario.url, {
      schema,
      prompt: EXTRACT_PROMPT(scenario.kind),
    })
    const data = result.data as z.infer<typeof schema>
    const items = data.items ?? []
    return {
      scenarioId: scenario.id,
      itemCount: items.length,
      sampleTitles: items.slice(0, 5).map((it) => it.title),
      elapsedSec: (Date.now() - t0) / 1000,
      parsewCalls,
      parsewCostUSDEstimate: parsewCalls * COST_PER_EXTRACT,
    }
  } catch (err) {
    return {
      scenarioId: scenario.id,
      itemCount: 0,
      sampleTitles: [],
      elapsedSec: (Date.now() - t0) / 1000,
      parsewCalls,
      parsewCostUSDEstimate: parsewCalls * COST_PER_EXTRACT,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }
  }
}
