export interface Scenario {
  id: string
  label: string
  pathA: {
    location: { label: string; lat: number; lng: number; radiusKm: number }
    interests: string[]
    language: string
    topN: number
  }
  pathB: {
    prompt: string
  }
}

const COMMON_RULES = `WHAT COUNTS AS A GOOD SOURCE:
- Hyperlocal / on-topic for the specified focus, not a global aggregator
- "Listing-shaped": URL points at a page that LISTS many entries (not a single item, not a generic homepage)
- Regularly updated — content visible for current and upcoming weeks
- Authoritative source: official venue/employer/municipal/regional site, well-known curated magazine; NOT SEO content farms

AVOID:
- Generic aggregators: eventbrite, facebook, linkedin, instagram, ticketmaster, meetup, reddit, indeed (unless they have a vertical-specific section)
- Sites with stale content (latest entry >6 months ago)
- Ticket-resale-only sites with no curation

HOW TO RESEARCH:
- Search in the LOCAL language too, not just English. Local listing sites often rank only on native-language queries.
- Use web_fetch to verify candidates: does the page actually list multiple upcoming entries? Read titles/dates to confirm.
- Discard candidates that fail verification.

OUTPUT FORMAT — when you're done, emit a single fenced JSON block exactly like:

\`\`\`json
{
  "candidates": [
    {
      "url": "https://example.com/agenda",
      "domain": "example.com",
      "reason": "Why this fits (one sentence).",
      "freshness_evidence": "Title + date you observed on the page",
      "language": "nl"
    }
  ]
}
\`\`\`

Only include URLs you actually verified with web_fetch. Quality over quantity — 5 strong sources beat 12 weak ones. Aim for 8-12 if you can confirm them.`

export const SCENARIOS: Scenario[] = [
  {
    id: 'enschede-events',
    label: 'Enschede local events (NL)',
    pathA: {
      location: { label: 'Enschede', lat: 52.2215, lng: 6.8937, radiusKm: 25 },
      interests: ['music', 'arts', 'food'],
      language: 'nl',
      topN: 10,
    },
    pathB: {
      prompt: `You are helping build a personalised local-events digest.

TASK: Find the best, most-current event-listing websites for Enschede (Netherlands), focused on interests: music, arts, food. The city is in Twente / Overijssel — regional listing sites are fair game (e.g. for Hengelo, Bad Bentheim).

${COMMON_RULES}`,
    },
  },
  {
    id: 'lisbon-events',
    label: 'Lisbon local events (PT)',
    pathA: {
      location: { label: 'Lisboa', lat: 38.7223, lng: -9.1393, radiusKm: 25 },
      interests: ['music', 'arts', 'food'],
      language: 'pt',
      topN: 10,
    },
    pathB: {
      prompt: `You are helping build a personalised local-events digest.

TASK: Find the best, most-current event-listing websites for Lisbon (Lisboa), Portugal, focused on interests: music, arts, food. Greater Lisbon counts — Sintra, Cascais, Almada are fair game.

${COMMON_RULES}`,
    },
  },
  {
    id: 'fashion-workplace',
    label: 'Fashion Workplace (EU fashion jobs)',
    pathA: {
      // The current pipeline is event-tuned. We feed it the closest analog:
      // a "location" of Europe (using Brussels coords as a center) and
      // fashion-industry interests. We expect it to mostly miss the target.
      location: { label: 'Europe', lat: 50.8503, lng: 4.3517, radiusKm: 2000 },
      interests: ['fashion jobs', 'designer', 'buyer', 'retail', 'merchandising'],
      language: 'en',
      topN: 10,
    },
    pathB: {
      prompt: `You are helping build a candidates list for a personalised fashion-industry job digest.

TASK: Find the best fashion-industry job-listing websites operating across Europe (any country, any language). Target audience: fashion professionals — designers, buyers, merchandisers, retail managers, marketing/PR in fashion houses.

WHAT COUNTS AS A GOOD SOURCE:
- Fashion-industry specific (NOT general job boards). Designer/buyer/merchandiser/retail roles in fashion houses, luxury brands, retailers.
- European reach — pan-EU, regional (Italy/France/UK/etc), or a city hub (Paris/Milan/London/Antwerp) with regular new postings.
- "Listing-shaped": page lists many open positions, not a single company's careers page.
- Regularly updated — postings with dates in the last 30-60 days.

AVOID:
- Generic global job boards (LinkedIn, Indeed, Glassdoor) unless they have a fashion-specific subsection URL.
- Recruiter aggregators that re-post stale listings.
- Single-company career pages.

HOW TO RESEARCH:
- Search in English plus key local fashion-capital languages (French, Italian).
- Look for: "fashion jobs", "luxury careers", "mode emploi", "moda lavoro", industry trade press job pages (BoF, Vogue Business, Fashion Network, WWD careers).
- Use web_fetch to verify each candidate: does the page list multiple recent postings?

OUTPUT FORMAT — when you're done, emit a single fenced JSON block exactly like:

\`\`\`json
{
  "candidates": [
    {
      "url": "https://example.com/jobs",
      "domain": "example.com",
      "reason": "Why this fits (one sentence).",
      "freshness_evidence": "Sample posting title + date you observed",
      "language": "en"
    }
  ]
}
\`\`\`

Only include URLs you actually verified with web_fetch. Quality over quantity. Aim for 8-12 if you can confirm them.`,
    },
  },
]
