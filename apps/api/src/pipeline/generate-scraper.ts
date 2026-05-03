import { z } from 'zod'
import { runCSSScraper, looksPlausible, type CSSScraperConfig } from '@uitagenda/scrapers'
import type { LLMClient } from '@uitagenda/llm'

export type ScraperResult =
  | { kind: 'css'; config: CSSScraperConfig; sampleEventCount: number }
  | { kind: 'extract'; reason: string }

const cssConfigSchema = z.object({
  itemSelector: z.string().min(1),
  baseUrl: z.string().url().optional(),
  fields: z.object({
    title: z.string().min(1),
    url: z.string().min(1),
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
}

const SYSTEM = `You are a web-scraping expert. You will be given the HTML of an events listing page.
Return a JSON object describing CSS selectors for extracting events.
The "itemSelector" must match the repeating event container (each event in the listing).
Within each item, "fields.title" must match the event title, "fields.url" must match the detail-page anchor, and ideally "fields.startsAt" matches a date element (with "startsAtAttr" if the date is in an attribute like 'datetime').
Optional: venueName, description, imageUrl (with imageUrlAttr), priceText.`

export async function generateScraper(args: GenerateArgs): Promise<ScraperResult> {
  const maxAttempts = args.maxAttempts ?? 2
  let feedback = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPrompt(args.html, args.baseUrl, feedback)
    const config = await args.llm.generateObject({
      task: 'scraperGen',
      schema: cssConfigSchema,
      system: SYSTEM,
      prompt,
    })
    const merged: CSSScraperConfig = { ...config, baseUrl: config.baseUrl ?? args.baseUrl }
    const { events } = runCSSScraper(args.html, merged)
    if (looksPlausible(events)) {
      return { kind: 'css', config: merged, sampleEventCount: events.length }
    }
    feedback = `Previous attempt produced ${events.length} events; not plausible. Pick a different itemSelector or field selectors that match actual class/element names visible in the HTML.`
  }

  return { kind: 'extract', reason: `CSS generation failed after ${maxAttempts} attempts` }
}

function buildPrompt(html: string, baseUrl: string, feedback: string): string {
  const trimmed = html.length > 30000 ? html.slice(0, 30000) + '\n<!-- ...truncated -->' : html
  return [
    `Base URL: ${baseUrl}`,
    feedback ? `\nFeedback from previous attempt:\n${feedback}\n` : '',
    `\nHTML:\n${trimmed}`,
  ].join('')
}
