// Date rescue: convert raw date strings ("3 mei", "vrijdag 9 mei", "t/m 5 jun
// 2026") to ISO-8601 in a single batched LLM call. Used after the CSS scraper
// runs — many non-English event sites surface dates as text, not <time
// datetime>. Cheap (gpt-5-nano), runs only on the events that need it.

import { z } from 'zod'
import type { ScrapedEvent } from '@uitagenda/scrapers'
import type { LLMClient } from '@uitagenda/llm'

const schema = z.object({
  parsed: z.array(
    z.object({
      index: z.number().describe('the [N] index of the input line this verdict applies to'),
      isoDate: z
        .string()
        .nullable()
        .describe('ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss). null if the input has no recognizable date.'),
    }),
  ),
})

export interface RescueDatesArgs {
  events: ScrapedEvent[]
  language: string
  // Used as the "today" reference for relative dates ("Friday", "tomorrow")
  // and for picking the next future occurrence when the year is missing.
  referenceDate: Date
  llm: Pick<LLMClient, 'generateObject'>
}

export interface RescueDatesResult {
  events: ScrapedEvent[]
  rescuedCount: number
  attemptedCount: number
}

export async function rescueDates(args: RescueDatesArgs): Promise<RescueDatesResult> {
  // Only events that have raw text but no parsed date.
  const targets: { index: number; raw: string }[] = []
  args.events.forEach((e, i) => {
    if (e.startsAt === null && e.rawStartsAt) {
      targets.push({ index: i, raw: e.rawStartsAt })
    }
  })
  if (targets.length === 0) {
    return { events: args.events, rescuedCount: 0, attemptedCount: 0 }
  }

  const today = args.referenceDate.toISOString().slice(0, 10)
  const { parsed } = await args.llm.generateObject({
    task: 'dateRescue',
    schema,
    system: `You convert localized date strings into ISO-8601 timestamps. Today is ${today} (UTC). Page language: ${args.language}.

Rules:
- Output exactly one verdict per input line, matching the [N] index.
- If the year is missing, pick the NEXT future occurrence (>= today).
- If the time is missing, omit the time portion (return YYYY-MM-DD).
- Strip range/preposition prefixes like "t/m", "tot", "until", "from", "vanaf" — return the START date.
- Strip suffixes like venue/city names that aren't part of the date.
- Return null only if the line genuinely contains no date information.`,
    prompt: targets.map((t) => `[${t.index}] ${t.raw}`).join('\n'),
    maxOutputTokens: 1024,
  })

  const byIndex = new Map(parsed.map((p) => [p.index, p.isoDate]))
  let rescued = 0
  const out = args.events.map((e, i) => {
    if (e.startsAt !== null) return e
    const iso = byIndex.get(i)
    if (!iso) return e
    const ms = Date.parse(iso)
    if (Number.isNaN(ms)) return e
    rescued++
    return { ...e, startsAt: new Date(ms) }
  })

  return { events: out, rescuedCount: rescued, attemptedCount: targets.length }
}
