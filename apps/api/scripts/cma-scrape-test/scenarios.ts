// Scrape test corpus. Selected to span easy → hard:
//   1-3: should work for both paths (control)
//   4-5: Vercel SPA + suspicious tiny response — possible Parsew failure modes
//   6:   confirmed Cloudflare bot wall on the bare HTML
export interface ScrapeScenario {
  id: string
  label: string
  url: string
  // Hint to the extractor about what kind of listing to expect.
  kind: 'events' | 'jobs'
  notes: string
}

export const SCRAPE_SCENARIOS: ScrapeScenario[] = [
  {
    id: 'visittwente-agenda',
    label: 'Visit Twente — agenda (NL events, easy)',
    url: 'https://www.visittwente.nl/agenda/',
    kind: 'events',
    notes: 'Apache, no bot wall, large body. Control — both should succeed.',
  },
  {
    id: 'metropool-agenda',
    label: 'Metropool — agenda (NL venue, easy)',
    url: 'https://www.metropool.nl/agenda',
    kind: 'events',
    notes: 'Major pop venue. ~100KB body. Control.',
  },
  {
    id: 'fashionunited-uk-jobs',
    label: 'FashionUnited UK — jobs (large body, expected scrapable)',
    url: 'https://fashionunited.uk/fashion-jobs',
    kind: 'jobs',
    notes: '~184KB body, nginx, no bot marker. Expected scrapable.',
  },
  {
    id: 'fashionworkplace-jobs',
    label: 'Fashion Workplace — jobs (Vercel SPA, JS-rendered)',
    url: 'https://www.fashionworkplace.com/jobs',
    kind: 'jobs',
    notes:
      '349KB body, Vercel/Next.js, contains "enable JavaScript" marker. Likely JS-rendered SPA — bare HTML may not contain listings.',
  },
  {
    id: 'drapersjobs',
    label: 'Drapers Jobs — fashion trade press (tiny response, suspicious)',
    url: 'https://www.drapersjobs.com/jobs',
    kind: 'jobs',
    notes:
      '3.7KB body — far too small for a listings page. Probably JS-only or auth-gated.',
  },
  {
    id: 'fashionnetwork-jobs',
    label: 'FashionNetwork — jobs (confirmed Cloudflare bot wall)',
    url: 'https://www.fashionnetwork.com/jobs/',
    kind: 'jobs',
    notes:
      'Curl hits Cloudflare challenge page (~5KB challenge HTML). The interesting case for "no residential proxies".',
  },
]

export const EXTRACT_PROMPT = (kind: 'events' | 'jobs') =>
  kind === 'events'
    ? 'Extract every event listing on this page. For each: title, absolute URL to detail page, ISO-8601 startsAt if visible, venueName if present, description if present.'
    : 'Extract every job listing on this page. For each: title, absolute URL to detail page, companyName if visible, location if present, postedAt as ISO-8601 if present, description if present.'
