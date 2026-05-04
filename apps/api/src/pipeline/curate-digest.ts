// LLM-driven digest curation. Takes a candidate event list + the recipient's
// profile (name, location, interests, cadence) and asks the model to:
//
//  1. write a personal intro that references the recipient's tastes,
//  2. select the top picks for the cadence window,
//  3. order them in a way that flows nicely (today first, hero up top),
//  4. write a one-line blurb per pick explaining why it suits them,
//  5. write a short closer.
//
// We pre-filter candidates by cheap keyword relevance before sending so the
// model's input stays small; the model is only deciding among events that
// already match at least one of the recipient's interests.

import { z } from 'zod'
import type { LLMClient } from '@dolimoyo/llm'

export interface CandidateEvent {
  id: string
  title: string
  startsAt: string | null
  venueName: string | null
  description: string | null
  matched: string[]
}

export interface CurateArgs {
  recipientName: string
  locationLabel: string
  interests: string[]
  cadence: 'daily' | 'bidaily' | 'weekly'
  // Reference time for "today / tomorrow" reasoning.
  referenceDate: Date
  // Pre-filtered, keyword-ranked candidates. Order is hint, not law.
  candidates: CandidateEvent[]
  llm: Pick<LLMClient, 'generateObject'>
  maxPicks?: number
}

export interface CuratedDigest {
  subject: string
  intro: string
  picks: Array<{
    eventId: string
    blurb: string
  }>
  closer: string
}

const curationSchema = z.object({
  subject: z.string().describe('Email subject line. Specific, warm, under 70 chars. No emojis.'),
  intro: z.string().describe('Personal greeting (2-3 short sentences) referencing the recipient\'s actual interests and what stood out in this batch. Address them by name.'),
  picks: z.array(
    z.object({
      eventId: z.string().describe('Must match a candidate id exactly.'),
      blurb: z.string().describe('One short sentence explaining why this fits the recipient. Concrete, no marketing fluff.'),
      displayTitle: z.string().describe('Cleaned-up title — almost always EMPTY STRING. Set ONLY when the candidate title is visibly broken (e.g. dates or city smushed in: "Twentse Vlooienmarkt3 meiEnschede" → "Twentse Vlooienmarkt"). Empty string for clean titles.'),
    }),
  ).describe('Selected events in display order. Skip the candidates that don\'t actually match this person; quality over quantity.'),
  closer: z.string().describe('One short closing sentence (≤120 chars). Friendly. No emojis. No "Cheers".'),
})

export async function curateDigest(args: CurateArgs): Promise<CuratedDigest> {
  const maxPicks = args.maxPicks ?? 8
  const todayISO = args.referenceDate.toISOString().slice(0, 10)
  const cadenceWindow = describeCadenceWindow(args.cadence)

  const system = `You curate a personalised local-events digest. The goal is for the recipient to open this and immediately think "yes, that's for me".

Voice: like a friend who knows the local scene texting a few things they should consider. Warm, specific, never breathless or salesy. No emojis. No exclamation overload. No "don't miss out".

Selection rules:
- Pick at most ${maxPicks} events. Fewer is better than padding with filler.
- Skip anything that doesn't actually match the recipient's interests, even if a candidate is in the list. Quality over quantity.
- Lead with the strongest match for ${cadenceWindow}. Time-sensitive things (tonight, tomorrow) before later-in-window things.
- Diversity matters: don't stack three jazz nights if there's also a market and a film screening.

Blurb rules:
- Reference WHY this fits the recipient. Use their words ("modern arts", "jazz") when it's honest.
- One sentence. Concrete. No "you'll love this", no "amazing".
- If the event description is in another language, the blurb is still in English.

Title cleanup:
- Most titles are clean — leave displayTitle unset.
- Only set displayTitle when the candidate title is visibly broken: dates or city names smushed in without spaces, ASCII soup like "..3 mei", or trailing venue-string fragments. Strip those, return the actual event name.
- Never paraphrase a clean title. If in doubt, leave it.

Each pick's eventId MUST exactly match one of the provided candidate ids.`

  const prompt = [
    `Recipient: ${args.recipientName}`,
    `Location: ${args.locationLabel}`,
    `Interests: ${args.interests.join(', ')}`,
    `Cadence: ${args.cadence} (${cadenceWindow})`,
    `Today (UTC): ${todayISO}`,
    ``,
    `Candidates (already keyword-pre-filtered; the "matched" tag tells you which interest words showed up in the title/venue/description):`,
    ...args.candidates.map((c) => formatCandidate(c)),
  ].join('\n')

  const result = await args.llm.generateObject({
    task: 'digestCuration',
    schema: curationSchema,
    system,
    prompt,
  })

  // Defend against the model picking ids that don't exist.
  const candidateIds = new Set(args.candidates.map((c) => c.id))
  const cleaned = result.picks.filter((p) => candidateIds.has(p.eventId)).slice(0, maxPicks)
  return { ...result, picks: cleaned }
}

function formatCandidate(c: CandidateEvent): string {
  const parts = [`- id=${c.id}`, `title="${c.title.replace(/"/g, "'")}"`]
  if (c.startsAt) parts.push(`when=${c.startsAt.slice(0, 16)}`)
  if (c.venueName) parts.push(`venue="${c.venueName.replace(/"/g, "'")}"`)
  if (c.matched.length > 0) parts.push(`matched=[${c.matched.join('|')}]`)
  if (c.description) parts.push(`desc="${truncate(c.description, 160).replace(/"/g, "'")}"`)
  return parts.join(' ')
}

function describeCadenceWindow(c: 'daily' | 'bidaily' | 'weekly'): string {
  if (c === 'daily') return 'today and tomorrow'
  if (c === 'bidaily') return 'the next 48 hours'
  return 'the next 7 days'
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1).trimEnd() + '…'
}
