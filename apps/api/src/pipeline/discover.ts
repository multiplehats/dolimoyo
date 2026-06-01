import type { AnthropicHandles, ModelUsage } from '../services/anthropic'

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
  language: string
}

export interface DiscoverArgs {
  location: Location
  interests: string[]
  // Hint only — the agent searches in whichever languages it judges relevant
  // for the location. Pass when the caller has strong reason to bias output
  // language for downstream curation.
  language?: string
  anthropic: AnthropicHandles
  topN?: number
  // Optional. When set, the discovery prompt nudges the agent to include
  // neighbouring areas (Enschede → Twente, Hengelo, Bad Bentheim).
  nearbyAreas?: string[]
  // Override for tests or long-running scenarios. Default 5 min.
  timeoutMs?: number
}

interface AgentCandidate {
  url: string
  domain: string
  title?: string
  reason?: string
  freshness_evidence?: string
  language?: string
  score?: number
}

const SYSTEM_PROMPT = `You are a hyperlocal web-research agent. Your job is to find high-quality listing websites for a personalised local-events digest.

You have access to web search and web fetch in a sandbox. Your output is consumed programmatically — when you finish, emit ONE fenced JSON block matching the user's schema. No JSON outside the fence, no second fence with different content. After the JSON, you may add brief notes.

Be skeptical. Verify candidates with web_fetch before listing them — confirm the page actually shows multiple recent entries. Never list a URL you haven't opened. Quality over quantity.`

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const HARD_KILL_BUFFER_MS = 60_000

export async function discoverSources(args: DiscoverArgs): Promise<DiscoveredSource[]> {
  const topN = args.topN ?? 5
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const { client, recordUsage } = args.anthropic

  const agent = await client.beta.agents.create({
    name: 'dolimoyo-discovery',
    model: 'claude-sonnet-4-6',
    system: SYSTEM_PROMPT,
    tools: [{ type: 'agent_toolset_20260401' }],
  })
  const environment = await client.beta.environments.create({
    name: 'dolimoyo-discovery-env',
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  })

  const session = await client.beta.sessions.create({
    agent: agent.id,
    environment_id: environment.id,
    title: `discovery:${args.location.label}`,
  })

  const stream = await client.beta.sessions.events.stream(session.id)
  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: buildUserPrompt(args) }],
      },
    ],
  })

  const textChunks: string[] = []
  const usages: ModelUsage[] = []
  const hardDeadline = Date.now() + timeoutMs + HARD_KILL_BUFFER_MS
  let timedOut = false

  // Soft-deadline: ask the agent to wrap up. Hard-deadline below kills the loop.
  const softTimer = setTimeout(() => {
    timedOut = true
    client.beta.sessions.events
      .send(session.id, {
        events: [
          {
            type: 'user.message',
            content: [
              {
                type: 'text',
                text:
                  "Time's up — STOP further research and emit your final JSON block with the verified candidates you have. Then stop.",
              },
            ],
          },
        ],
      })
      .catch(() => {})
  }, timeoutMs)

  try {
    for await (const ev of stream as AsyncIterable<Record<string, unknown>>) {
      const type = ev.type as string
      if (type === 'agent.message') {
        const content = (ev.content as Array<{ type: string; text?: string }>) ?? []
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') textChunks.push(block.text)
        }
      } else if (type === 'span.model_request_end') {
        const u = ev.model_usage as ModelUsage | undefined
        if (u) usages.push(u)
      } else if (type === 'session.status_idle') {
        break
      } else if (type === 'session.error' || type === 'agent.error') {
        throw new Error(`CMA session error: ${JSON.stringify(ev).slice(0, 500)}`)
      }
      if (Date.now() > hardDeadline) {
        timedOut = true
        break
      }
    }
  } finally {
    clearTimeout(softTimer)
    const totalUsage = sumUsages(usages)
    if (totalUsage.input_tokens || totalUsage.output_tokens) {
      // Record one ledger row per discovery session so the dashboard
      // reflects per-discovery cost without aggregating per-tool-call rows.
      await recordUsage(`discovery:claude-sonnet-4-6`, totalUsage)
    }
  }

  const rawText = textChunks.join('')
  const candidates = parseCandidates(rawText)
  if (candidates.length === 0) {
    console.log(
      `[discover] no candidates parsed. timedOut=${timedOut} textLen=${rawText.length} sessionId=${session.id} tail=${JSON.stringify(rawText.slice(-800))}`,
    )
    if (timedOut) throw new Error('CMA discovery timed out before emitting candidates')
  }

  return candidates
    .map(toDiscoveredSource)
    .filter((s): s is DiscoveredSource => s !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

function buildUserPrompt(args: DiscoverArgs): string {
  const nearby = args.nearbyAreas?.length
    ? `\nRegional listing sites are fair game — nearby areas: ${args.nearbyAreas.join(', ')}.`
    : ''
  const langHint = args.language
    ? `\nPrimary content language: ${args.language}. Search in this language as well as English.`
    : ''
  return `You are helping build a personalised local-events digest.

TASK: Find the best, most-current event-listing websites for ${args.location.label}, focused on interests: ${args.interests.join(', ')}.${nearby}${langHint}

WHAT COUNTS AS A GOOD SOURCE:
- Hyperlocal / on-topic for this location, not a global aggregator
- "Listing-shaped": URL points at a page that LISTS many entries (not a single item, not a generic homepage)
- Regularly updated — content visible for current and upcoming weeks
- Authoritative: official venue/municipal/regional site, well-known curated magazine; NOT SEO content farms

AVOID:
- Generic aggregators: eventbrite, facebook, linkedin, instagram, ticketmaster, meetup, reddit, indeed
- Sites with stale content (latest entry >6 months ago)
- Ticket-resale-only sites with no curation

HOW TO RESEARCH:
- Search in the LOCAL language too, not just English.
- Use web_fetch to verify each candidate: does the page actually list multiple upcoming entries? Read titles/dates to confirm.
- Discard candidates that fail verification.

OUTPUT FORMAT — when you're done, emit a SINGLE fenced JSON block exactly like:

\`\`\`json
{
  "candidates": [
    {
      "url": "https://example.com/agenda",
      "domain": "example.com",
      "title": "Short human-readable label, e.g. site name",
      "reason": "Why this fits (one sentence).",
      "freshness_evidence": "Title + date you observed on the page",
      "language": "nl",
      "score": 9
    }
  ]
}
\`\`\`

Rules for the JSON:
- Only include URLs you actually verified with web_fetch.
- "score" is your 0-10 confidence that this is a high-quality, regularly-updated listing source for this location. 10 = authoritative + current + listing-shaped. <5 means not strong enough to include — leave it out.
- Aim for ${Math.max(8, (args.topN ?? 5) + 3)}-12 candidates if you can confirm them. Quality over quantity.`
}

function parseCandidates(text: string): AgentCandidate[] {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  for (let i = matches.length - 1; i >= 0; i--) {
    const body = matches[i]?.[1]?.trim()
    if (!body) continue
    try {
      const parsed = JSON.parse(body) as { candidates?: AgentCandidate[] }
      if (Array.isArray(parsed.candidates)) return parsed.candidates
    } catch {
      // try next-most-recent
    }
  }
  // Bare-object fallback if the agent forgot the fence.
  const m = text.match(/\{\s*"candidates"\s*:\s*\[[\s\S]*?\]\s*\}/)
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as { candidates?: AgentCandidate[] }
      if (Array.isArray(parsed.candidates)) return parsed.candidates
    } catch {
      /* ignore */
    }
  }
  return []
}

function toDiscoveredSource(c: AgentCandidate): DiscoveredSource | null {
  if (!c.url) return null
  const domain = c.domain || safeDomain(c.url)
  if (!domain) return null
  const score = typeof c.score === 'number' ? Math.max(0, Math.min(10, c.score)) : 7
  return {
    listingUrl: c.url,
    domain,
    title: c.title ?? domain,
    score,
    language: (c.language ?? 'en').toLowerCase().slice(0, 5),
  }
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function sumUsages(usages: ModelUsage[]): ModelUsage {
  const total: Required<ModelUsage> = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  for (const u of usages) {
    total.input_tokens += u.input_tokens ?? 0
    total.output_tokens += u.output_tokens ?? 0
    total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
    total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
  }
  return total
}
