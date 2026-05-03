// Cluster events that probably refer to the same real-world happening but were
// captured from different sources. Greedy token-Jaccard clustering inside a
// day-window: catches title variants like "Concert: Berget Lewis at Wilmink"
// vs "Berget Lewis - Concert" (Jaccard ≈ 0.5 on shared tokens). Free and
// deterministic; embedding-based clustering remains an option if Jaccard
// proves too coarse for some cases.

import type { EventRecord, SourceRecord } from './types.ts'

export interface DedupeArgs {
  events: EventRecord[]
  sources: SourceRecord[]
  // Tunables exposed for tests + cli experiments.
  jaccardThreshold?: number
  dayWindow?: number
}

export interface DedupeResult {
  // One canonical event per cluster, in original order.
  canonical: EventRecord[]
  // Total events folded into other clusters (events.length - canonical.length).
  duplicatesRemoved: number
  // For inspection: each cluster's members.
  clusters: Array<{ canonical: EventRecord; duplicates: EventRecord[] }>
}

const DEFAULT_JACCARD = 0.5
const DEFAULT_DAY_WINDOW = 1
// Stop-words that show up across many event titles and inflate Jaccard noise.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'at', 'in', 'on', 'of', 'for', 'and', 'or', 'with', 'to',
  'het', 'de', 'een', 'in', 'op', 'aan', 'en', 'of', 'met', 'bij', 'voor',
  'la', 'el', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'o', 'con', 'por',
  'event', 'concert', 'show', 'live',
])

interface Cluster {
  canonical: EventRecord
  members: EventRecord[]
  // Pre-computed token set for the canonical's title — the Jaccard anchor.
  tokens: Set<string>
  dayKey: string
}

export function dedupeEvents(args: DedupeArgs): DedupeResult {
  const sourceById = new Map(args.sources.map((s) => [s.id, s]))
  const threshold = args.jaccardThreshold ?? DEFAULT_JACCARD
  const dayWindow = args.dayWindow ?? DEFAULT_DAY_WINDOW

  // Sort: highest-discoveryScore first, then earliest fetch — anchors clusters
  // around the source we trust most, so weaker-source duplicates fold in.
  const sorted = [...args.events].sort((a, b) => {
    const sa = sourceById.get(a.sourceId)?.discoveryScore ?? 0
    const sb = sourceById.get(b.sourceId)?.discoveryScore ?? 0
    if (sa !== sb) return sb - sa
    return a.fetchedAt.localeCompare(b.fetchedAt)
  })

  const clusters: Cluster[] = []
  for (const e of sorted) {
    const tokens = tokenize(e.title)
    const day = dayKey(e)
    let bestIdx = -1
    let bestScore = threshold
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]!
      if (!daysWithin(day, c.dayKey, dayWindow)) continue
      const sim = jaccard(tokens, c.tokens)
      if (sim > bestScore) {
        bestScore = sim
        bestIdx = i
      }
    }
    if (bestIdx >= 0) {
      clusters[bestIdx]!.members.push(e)
    } else {
      clusters.push({ canonical: e, members: [e], tokens, dayKey: day })
    }
  }

  const canonical = clusters.map((c) => c.canonical)
  const out = clusters.map((c) => ({
    canonical: c.canonical,
    duplicates: c.members.slice(1),
  }))
  const duplicatesRemoved = clusters.reduce((a, c) => a + (c.members.length - 1), 0)
  return { canonical, duplicatesRemoved, clusters: out }
}

// "Concert: Berget Lewis at Wilminktheater" → {berget, lewis, wilminktheater}
// Strips stop-words and 1-char tokens that would inflate similarity.
export function tokenize(s: string): Set<string> {
  const norm = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
  const tokens = norm.split(/\s+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  const union = a.size + b.size - intersect
  return union === 0 ? 0 : intersect / union
}

function dayKey(e: EventRecord): string {
  return e.startsAt ? e.startsAt.slice(0, 10) : 'undated'
}

// True when the two day keys are within ±window days, or both are 'undated'.
function daysWithin(a: string, b: string, window: number): boolean {
  if (a === 'undated' || b === 'undated') return a === b
  const da = Date.parse(a)
  const db = Date.parse(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return a === b
  const diff = Math.abs(da - db) / 86400000
  return diff <= window
}
