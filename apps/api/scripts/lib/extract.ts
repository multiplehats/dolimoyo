import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ParsewClient } from '@uitagenda/parsew'
import type { LocalStore } from './store.ts'
import type { EventRecord, SourceRecord } from './types.ts'

export const eventsSchema = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      startsAt: z.string().describe('ISO-8601 if dated, otherwise empty string'),
      endsAt: z.string().nullable().optional(),
      venueName: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      imageUrl: z.string().nullable().optional(),
      priceText: z.string().nullable().optional(),
      isRecurring: z
        .boolean()
        .describe(
          'true if the listing presents itself as ongoing/permanent or weekly/perpetual (e.g., "every Sunday", "always open", "permanent collection", "visit our church"). false for one-off dated events.',
        ),
      recurringReason: z
        .string()
        .nullable()
        .optional()
        .describe('When isRecurring=true, ≤12 words on why. Empty otherwise.'),
    }),
  ),
})

export const EXTRACT_PROMPT =
  'Extract every event listing on this page. For each: title; absolute URL to the detail page; ISO-8601 startsAt (or empty if undated); endsAt if present; venueName, description, imageUrl, priceText if present. Critically: set isRecurring=true for entries that are perennial/static ("permanent collection", "visit our church", "always open", weekly/recurring services), and isRecurring=false for time-bound one-off events. When isRecurring=true also fill recurringReason with a ≤12-word phrase explaining why.'

export interface ExtractResult {
  upserted: EventRecord[]
  perennials: EventRecord[]
  oneoffs: EventRecord[]
  elapsedSec: number
  parsewCalls: number
  warning: string | null
}

export async function extractFromSource(args: {
  store: LocalStore
  source: SourceRecord
  parsew: ParsewClient
  url?: string
}): Promise<ExtractResult> {
  const url = args.url ?? args.source.listingUrl
  let parsewCalls = 0
  // We can't easily count calls from outside without an onCall ref; assume caller
  // passed a parsew instance whose ledger is wired up if they want totals.
  const t0 = Date.now()
  const result = await args.parsew.extract(url, {
    schema: eventsSchema,
    prompt: EXTRACT_PROMPT,
  })
  parsewCalls = 1
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1))

  const data = result.data as z.infer<typeof eventsSchema>
  const upserted = data.events.map((e) => {
    const startsAt = e.startsAt && e.startsAt.trim() ? e.startsAt : null
    const contentHash = sha1(`${e.title}|${startsAt ?? ''}|${e.venueName ?? ''}|${e.url}`)
    return args.store.upsertEvent({
      sourceId: args.source.id,
      title: e.title,
      url: e.url,
      startsAt,
      endsAt: e.endsAt ?? null,
      venueName: e.venueName ?? null,
      description: e.description ?? null,
      imageUrl: e.imageUrl ?? null,
      priceText: e.priceText ?? null,
      isRecurring: e.isRecurring,
      recurringReason: e.isRecurring ? (e.recurringReason ?? null) : null,
      language: args.source.language,
      contentHash,
    })
  })

  args.store.markSourceOk(args.source.id)
  args.store.recordExtractRun({
    sourceId: args.source.id,
    url,
    elapsedSec,
    parsewCalls,
    llmCostUSD: 0,
    eventCount: upserted.length,
    recurringCount: upserted.filter((e) => e.isRecurring).length,
    warning: result.warning ?? null,
  })

  return {
    upserted,
    perennials: upserted.filter((e) => e.isRecurring),
    oneoffs: upserted.filter((e) => !e.isRecurring),
    elapsedSec,
    parsewCalls,
    warning: result.warning ?? null,
  }
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16)
}
