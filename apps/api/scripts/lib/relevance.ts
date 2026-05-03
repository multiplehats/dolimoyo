// Lightweight interest-match scoring. Bag-of-words against title + venue +
// description; one shared token = +1, multi-word interest match = +2. Free,
// deterministic, locale-aware enough via accent stripping. An LLM rerank
// would be more nuanced but costs per event; reserve for when free signal
// proves too coarse.

import type { EventRecord } from './types.ts'

export interface RankedEvent extends EventRecord {
  score: number
  matched: string[]
}

export function rankByInterests(args: {
  events: EventRecord[]
  interests: string[]
}): RankedEvent[] {
  const interestTokens = args.interests.map((i) => ({
    raw: i,
    tokens: tokenize(i),
  }))
  return args.events
    .map((e) => {
      const haystack = tokenize(`${e.title} ${e.venueName ?? ''} ${e.description ?? ''}`)
      let score = 0
      const matched: string[] = []
      for (const interest of interestTokens) {
        if (interest.tokens.size === 0) continue
        // Multi-word interest counts double when ALL words show up.
        const allHit = [...interest.tokens].every((t) => haystack.has(t))
        if (allHit) {
          score += interest.tokens.size > 1 ? 2 : 1
          matched.push(interest.raw)
          continue
        }
        // Partial hit: at least one token of a multi-word interest in haystack.
        const partialHit = [...interest.tokens].some((t) => haystack.has(t))
        if (partialHit) {
          score += 0.5
          matched.push(interest.raw)
        }
      }
      return { ...e, score, matched }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Tiebreak on earlier date — sooner > later.
      const ta = a.startsAt ? new Date(a.startsAt).getTime() : Number.POSITIVE_INFINITY
      const tb = b.startsAt ? new Date(b.startsAt).getTime() : Number.POSITIVE_INFINITY
      return ta - tb
    })
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  )
}
