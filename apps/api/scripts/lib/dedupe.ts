// Cluster events that probably refer to the same real-world happening but were
// captured from different sources. Phase 0 uses simple normalization +
// same-day bucket; Phase 1 spec calls for embedding-based clustering.

import type { EventRecord, SourceRecord } from './types.ts'

export interface DedupeArgs {
  events: EventRecord[]
  sources: SourceRecord[]
}

export interface DedupeResult {
  // One canonical event per cluster, in original order.
  canonical: EventRecord[]
  // Total events folded into other clusters (events.length - canonical.length).
  duplicatesRemoved: number
  // For inspection: each cluster's members.
  clusters: Array<{ canonical: EventRecord; duplicates: EventRecord[] }>
}

export function dedupeEvents({ events, sources }: DedupeArgs): DedupeResult {
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const clusters = new Map<string, EventRecord[]>()
  for (const e of events) {
    const key = clusterKey(e)
    const bucket = clusters.get(key) ?? []
    bucket.push(e)
    clusters.set(key, bucket)
  }

  const canonical: EventRecord[] = []
  const out: Array<{ canonical: EventRecord; duplicates: EventRecord[] }> = []
  let duplicatesRemoved = 0

  for (const bucket of clusters.values()) {
    if (bucket.length === 1) {
      const c = bucket[0]
      if (c) {
        canonical.push(c)
        out.push({ canonical: c, duplicates: [] })
      }
      continue
    }
    // Pick the canonical: prefer the source with highest discoveryScore;
    // tiebreak on whichever event was fetched earliest.
    const sorted = [...bucket].sort((a, b) => {
      const sa = sourceById.get(a.sourceId)?.discoveryScore ?? 0
      const sb = sourceById.get(b.sourceId)?.discoveryScore ?? 0
      if (sa !== sb) return sb - sa
      return a.fetchedAt.localeCompare(b.fetchedAt)
    })
    const c = sorted[0]
    if (!c) continue
    const dups = sorted.slice(1)
    canonical.push(c)
    out.push({ canonical: c, duplicates: dups })
    duplicatesRemoved += dups.length
  }

  return { canonical, duplicatesRemoved, clusters: out }
}

function clusterKey(e: EventRecord): string {
  const day = e.startsAt ? e.startsAt.slice(0, 10) : 'undated'
  return `${day}|${normalizeTitle(e.title)}`
}

// Strip subtitles after dashes/colons, collapse whitespace, lowercase.
// "Celebrate The 80's With Berget Lewis!, Berget Lewis" → same as
// "Celebrate The 80's With Berget Lewis!"
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[—–\-:|,]/)[0]!
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
