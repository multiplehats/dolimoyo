import { z } from 'zod'
import { cleanHtml, runCSSScraper, looksPlausible, type CSSScraperConfig } from '@uitagenda/scrapers'
import type { LLMClient } from '@uitagenda/llm'
import { rescueDates } from './rescue-dates'

export type ScraperResult =
  | {
      kind: 'css'
      config: CSSScraperConfig
      sampleEventCount: number
      // True if the CSS structurally extracted events but their dates needed
      // a date-rescue LLM pass to be parseable. Refresh callers should plan
      // to run rescueDates on every refresh too, or the data won't have dates.
      requiresDateRescue: boolean
    }
  | { kind: 'extract'; reason: string }

const cssConfigSchema = z.object({
  itemSelector: z.string().min(1),
  baseUrl: z.string().optional(),
  fields: z.object({
    title: z.string().describe('CSS selector for the title element. Empty string "" means use the item element itself.'),
    url: z.string().describe('CSS selector for the <a> element. Empty string "" means the item element itself is the <a>. Runner reads its href automatically.'),
    startsAt: z.string().optional(),
    startsAtAttr: z.string().optional(),
    venueName: z.string().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    imageUrlAttr: z.string().optional(),
    priceText: z.string().optional(),
  }),
})

export interface GenerateArgs {
  html: string
  baseUrl: string
  llm: Pick<LLMClient, 'generateObject'>
  maxAttempts?: number
  // Defaults to 'en'. Used by the date-rescue pass to interpret localized
  // date strings (e.g. "3 mei" → 2026-05-03 for nl).
  language?: string
}

export const SCRAPER_GEN_SYSTEM = `You will be given the HTML of an events listing page. Return a JSON object describing CSS selectors that a cheerio-based runner will use to extract events.

CONVENTIONS — read carefully, the runner depends on these:
- itemSelector: a CSS selector matching the REPEATING event container in the listing. Each match becomes one event. Examples: "article.event", "li.agenda-item", ".event-card", "a.event-link"
- fields.title: CSS selector inside an item, points at the element whose text is the title. Runner reads .text().trim(). Use empty string "" if the title is the item element's OWN text.
- fields.url: CSS selector inside an item pointing at the <a>. Runner automatically reads its href (do NOT specify "@href" or "[href]"). Use empty string "" if the item element ITSELF is the <a>.
- fields.startsAt: CSS selector for a date element (optional but ideal).
- fields.startsAtAttr: if the date lives in an attribute (typically "datetime"), set this to "datetime". Otherwise omit and the runner reads element text.
- fields.venueName, description, imageUrl, priceText: optional, same selector convention. imageUrlAttr defaults to "src".

CSS SELECTOR RULES:
- Standard CSS only. NO XPath. NO "@attr". NO ":scope".
- Allowed: tag names (article, li, a, time, h1-h6), classes (.foo), ids (#bar), descendants (.a .b), children (.a > .b), attribute matchers ([class~="event"]).
- Pick selectors that ACTUALLY APPEAR in the HTML below. Read the real class names. Don't invent.
- The itemSelector should match MULTIPLE elements (≥3) for the page to be a viable listing.

WORKED EXAMPLE 1 — for HTML like:
  <article class="event-card">
    <h3 class="title"><a href="/e/123">Concert</a></h3>
    <time datetime="2026-05-10">May 10</time>
    <p class="venue">Hall</p>
  </article>
return:
  { "itemSelector": "article.event-card",
    "fields": { "title": ".title", "url": ".title a", "startsAt": "time", "startsAtAttr": "datetime", "venueName": ".venue" } }

WORKED EXAMPLE 2 — when the item itself is the anchor:
  <a class="event-card" href="/e/456"><h3>Festival</h3><time>2026-05-15</time></a>
return:
  { "itemSelector": "a.event-card",
    "fields": { "title": "h3", "url": "", "startsAt": "time" } }`

export async function generateScraper(args: GenerateArgs): Promise<ScraperResult> {
  const maxAttempts = args.maxAttempts ?? 2
  let feedback = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPrompt(args.html, args.baseUrl, feedback)
    const config = await args.llm.generateObject({
      task: 'scraperGen',
      schema: cssConfigSchema,
      system: SCRAPER_GEN_SYSTEM,
      prompt,
    })
    const merged: CSSScraperConfig = { ...config, baseUrl: config.baseUrl ?? args.baseUrl }
    const { events } = runCSSScraper(args.html, merged)
    if (looksPlausible(events)) {
      return { kind: 'css', config: merged, sampleEventCount: events.length, requiresDateRescue: false }
    }
    // If the structure is right (≥3 unique-titled events) but dates aren't
    // parseable as ISO/RFC strings, try the date-rescue LLM pass. Many
    // non-English sites surface dates as localized text ("3 mei" rather
    // than <time datetime>). Rescue is cheap (gpt-5-nano) and lets us keep
    // the CSS path for those sites.
    if (events.length >= 3 && hasParseabilityProblemOnly(events)) {
      // Only attempt rescue if the LLM at least *picked* a date selector and
      // got non-null rawStartsAt out of it — rescue can't conjure dates from
      // nothing. With nothing to rescue, give pointed feedback and try again.
      const withRaw = events.filter((e) => e.rawStartsAt).length
      if (withRaw === 0) {
        feedback = `Previous attempt extracted ${events.length} events but startsAt="${config.fields.startsAt ?? '(none)'}" matched 0 date elements. Look harder for a date — common patterns: <time datetime="...">, [data-date], <span class="date">, <p class="when">. Pick the selector that points at an element with a date string in its text or attributes. If the page truly has no inline dates per event, return your best structural config anyway and we'll fall through.`
        continue
      }
      const rescued = await rescueDates({
        events,
        language: args.language ?? 'en',
        referenceDate: new Date(),
        llm: args.llm,
      })
      if (looksPlausible(rescued.events)) {
        return {
          kind: 'css',
          config: merged,
          sampleEventCount: rescued.events.length,
          requiresDateRescue: true,
        }
      }
      // Rescue had material but couldn't parse it. Last attempt: feed the
      // raw strings back so the LLM picks a different (cleaner) selector.
      const sampleRaws = events.filter((e) => e.rawStartsAt).slice(0, 3).map((e) => `"${e.rawStartsAt}"`).join(', ')
      feedback = `Previous attempt's startsAt="${config.fields.startsAt ?? '(none)'}" produced raw strings like ${sampleRaws} that the date-rescue pass couldn't parse (${rescued.rescuedCount}/${rescued.attemptedCount} recovered). Pick a different date selector — try a <time> element with a datetime attribute (use startsAtAttr="datetime") or a more specific selector that excludes labels like "from"/"until".`
      continue
    }
    feedback = describeFailure(merged, events)
  }

  return { kind: 'extract', reason: `CSS generation failed after ${maxAttempts} attempts` }
}

function hasParseabilityProblemOnly(events: ReturnType<typeof runCSSScraper>['events']): boolean {
  const withDate = events.filter((e) => e.startsAt !== null).length
  const titles = new Set(events.map((e) => e.title.trim().toLowerCase()))
  const uniqueRatio = titles.size / events.length
  const dateRatio = withDate / events.length
  // Structure is healthy (titles unique enough), only dates are missing.
  return uniqueRatio >= 0.6 && dateRatio < 0.5
}

function describeFailure(
  config: CSSScraperConfig,
  events: ReturnType<typeof runCSSScraper>['events'],
): string {
  if (events.length === 0) {
    return `Previous attempt's itemSelector="${config.itemSelector}" matched 0 elements. Look at the HTML again — pick selectors visible in the HTML below.`
  }
  if (events.length < 3) {
    return `Previous attempt's itemSelector="${config.itemSelector}" matched only ${events.length} elements; need at least 3. Pick a more general repeating selector.`
  }
  const withDate = events.filter((e) => e.startsAt !== null).length
  if (withDate / events.length < 0.5) {
    const sampleTitles = events.slice(0, 3).map((e) => `"${e.title.slice(0, 40)}"`).join(', ')
    return `Previous attempt extracted ${events.length} events with titles ${sampleTitles}, but only ${withDate} had parseable dates with startsAt="${config.fields.startsAt ?? '(none)'}". The runner needs an ISO-8601 or RFC-2822 string. Look for a <time> element with a datetime attribute and use startsAtAttr="datetime", or pick a different selector pointing at a parseable date string.`
  }
  const titles = new Set(events.map((e) => e.title.trim().toLowerCase()))
  if (titles.size / events.length < 0.6) {
    return `Previous attempt's title selector "${config.fields.title}" produced duplicate titles (${titles.size} unique out of ${events.length}). Pick a more specific title selector — the current one is matching shared/static text instead of the per-event title.`
  }
  return `Previous attempt produced ${events.length} events; not plausible. Try different selectors.`
}

function buildPrompt(html: string, baseUrl: string, feedback: string): string {
  const cleaned = cleanHtml(html)
  // 120K chars ≈ 30K tokens — well within sonnet-4.6's 200K context. We were
  // hitting 60K too tight on event-rich pages (indexberlin had 371KB cleaned),
  // and the date markup often lives further down in the tree than 60K.
  const trimmed = cleaned.length > 120000 ? cleaned.slice(0, 120000) + '\n<!-- ...truncated -->' : cleaned
  return [
    `Base URL: ${baseUrl}`,
    feedback ? `\nFeedback from previous attempt:\n${feedback}\n` : '',
    `\nHTML (script/style/svg/iframes already stripped):\n${trimmed}`,
  ].join('')
}
