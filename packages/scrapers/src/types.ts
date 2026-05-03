export interface CSSScraperConfig {
  itemSelector: string
  fields: {
    title: string
    url: string
    startsAt?: string
    startsAtAttr?: string
    venueName?: string
    description?: string
    imageUrl?: string
    imageUrlAttr?: string
    priceText?: string
  }
  baseUrl?: string
}

export interface ScrapedEvent {
  title: string
  url: string
  startsAt: Date | null
  // The raw date text/attr value before Date.parse. Set even when startsAt is
  // null — used by the date-rescue LLM pass to recover non-English dates like
  // "3 mei" or "vrijdag 9 mei 2026".
  rawStartsAt: string | null
  venueName: string | null
  description: string | null
  imageUrl: string | null
  priceText: string | null
}

export interface RunResult {
  events: ScrapedEvent[]
  warnings: string[]
}
