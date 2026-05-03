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
  venueName: string | null
  description: string | null
  imageUrl: string | null
  priceText: string | null
}

export interface RunResult {
  events: ScrapedEvent[]
  warnings: string[]
}
