import { z } from 'zod'
import type { LLMClient } from '@uitagenda/llm'
import type { ParsewClient } from '@uitagenda/parsew'

export interface Location {
  label: string
  lat: number
  lng: number
  radiusKm: number
}

export interface DiscoveredSource {
  listingUrl: string
  domain: string
  title: string
  score: number
}

export interface DiscoverArgs {
  location: Location
  interests: string[]
  language: string
  parsew: Pick<ParsewClient, 'search' | 'map'>
  llm: Pick<LLMClient, 'generateObject'>
  topN?: number
}

// Match by base domain regardless of TLD — catches eventbrite.es,
// ticketmaster.de, tripadvisor.fr, etc. without per-region maintenance.
const BLOCKLIST_BASES = new Set([
  'eventbrite',
  'facebook',
  'fb',
  'instagram',
  'ticketmaster',
  'meetup',
  'reddit',
  'youtube',
  'tiktok',
  'tripadvisor',
])

function isBlocked(domain: string): boolean {
  // hostname like "www.eventbrite.es" → base "eventbrite"
  const parts = domain.split('.')
  // Skip a leading "www." or "m." or "es." etc. Treat the rightmost
  // non-TLD segment as the base.
  if (parts.length < 2) return false
  // base = second-to-last for x.y; for w.x.y use x; subdomains: m.facebook.com
  // → parts = ['m', 'facebook', 'com'], take parts[length-2] = 'facebook'.
  const base = parts[parts.length - 2]
  return base ? BLOCKLIST_BASES.has(base.toLowerCase()) : false
}

const LISTING_HINTS = ['agenda', 'event', 'evenement', 'uitagenda', 'concert', 'whats-on', 'whatson']

export async function discoverSources(args: DiscoverArgs): Promise<DiscoveredSource[]> {
  const { location, interests, language, parsew, llm } = args
  const topN = args.topN ?? 5

  const queries = buildSearchQueries(location.label, interests, language)
  const seenDomains = new Map<string, { url: string; title: string }>()

  for (const q of queries) {
    const r = await parsew.search(q, { lang: language, limit: 10 })
    for (const hit of r.results) {
      const domain = safeDomain(hit.url)
      if (!domain || isBlocked(domain)) continue
      if (!seenDomains.has(domain)) seenDomains.set(domain, { url: hit.url, title: hit.title })
    }
  }

  if (seenDomains.size === 0) return []

  // For each candidate domain, ask Parsew Map to find listing-shaped URLs.
  // Drop candidates whose map fails or yields no listing-shaped URL — one bad
  // site shouldn't abort the whole discovery run.
  const candidates: { domain: string; listingUrl: string; title: string }[] = []
  for (const [domain, hit] of seenDomains) {
    let map: { links: string[] }
    try {
      map = await parsew.map(hit.url, {
        search: 'agenda OR events OR uitagenda OR concert',
        limit: 20,
      })
    } catch {
      continue
    }
    const listingUrl = pickListingUrl(map.links, hit.url) ?? null
    if (!listingUrl) continue
    candidates.push({ domain, listingUrl, title: hit.title })
  }

  if (candidates.length === 0) return []

  const scoringSchema = z.object({
    scores: z.array(
      z.object({
        url: z.string(),
        score: z.number().describe('Integer 0–10 inclusive. 10 = best fit, 0 = unrelated.'),
      }),
    ),
  })

  const { scores } = await llm.generateObject({
    task: 'scoring',
    schema: scoringSchema,
    system: `You rate websites for how well they serve as a hyperlocal events listing for the given location and interests. Score 0-10. 10 = an authoritative, regularly-updated, listing-shaped events page for this location. 0 = unrelated, spam, or out of area.`,
    prompt: [
      `Location: ${location.label}`,
      `Interests: ${interests.join(', ')}`,
      `Language preference: ${language}`,
      ``,
      `Candidate listing URLs:`,
      ...candidates.map((c) => `- ${c.listingUrl} — ${c.title}`),
      ``,
      `Return a "scores" array with one entry per candidate URL above.`,
    ].join('\n'),
  })

  return scores
    .filter((s) => s.score >= 5)
    .map((s) => {
      const cand = candidates.find((c) => c.listingUrl === s.url)
      return cand
        ? { listingUrl: s.url, domain: cand.domain, title: cand.title, score: s.score }
        : null
    })
    .filter((x): x is DiscoveredSource => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

function buildSearchQueries(location: string, interests: string[], language: string): string[] {
  const stems =
    language === 'nl'
      ? ['uitagenda', 'evenementen agenda', 'wat te doen', 'concerten']
      : ['events', 'whats on', 'event listings', 'concerts']
  const base = stems.map((s) => `${s} ${location}`)
  const interestQs = interests.flatMap((i) =>
    [`${i} ${location} agenda`, `${i} ${location} events`],
  )
  return [...new Set([...base, ...interestQs])].slice(0, 8)
}

function pickListingUrl(links: string[], fallback: string): string | null {
  // Prefer URLs whose path contains a listing hint.
  const ranked = links
    .map((l) => ({ url: l, score: scoreLinkAsListing(l) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (ranked[0]) return ranked[0].url
  // Fallback: if the original search hit URL itself contains a listing hint, use it.
  return scoreLinkAsListing(fallback) > 0 ? fallback : null
}

function scoreLinkAsListing(url: string): number {
  try {
    const path = new URL(url).pathname.toLowerCase()
    let score = 0
    for (const hint of LISTING_HINTS) if (path.includes(hint)) score += 2
    if (path === '/' || path === '') score -= 1
    if (path.split('/').filter(Boolean).length > 3) score -= 1
    return score
  } catch {
    return 0
  }
}

function safeDomain(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}
