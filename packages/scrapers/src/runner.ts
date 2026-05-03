import * as cheerio from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { CSSScraperConfig, RunResult, ScrapedEvent } from './types'

// Derive the node type from cheerio's API to avoid importing domhandler directly
type CheerioNode = ReturnType<CheerioAPI> extends Cheerio<infer N> ? N : never

export function runCSSScraper(html: string, config: CSSScraperConfig): RunResult {
  const $ = cheerio.load(html)
  const events: ScrapedEvent[] = []
  const warnings: string[] = []

  $(config.itemSelector).each((_, el) => {
    const item = $(el)
    const title = pickText(item, config.fields.title)
    const urlRaw = pickAttr(item, config.fields.url, 'href')
    if (!title || !urlRaw) {
      warnings.push('item missing title or url; skipped')
      return
    }
    const url = absolutize(urlRaw, config.baseUrl)
    const startsAt = parseStartsAt(item, config)
    const venueName = config.fields.venueName ? pickText(item, config.fields.venueName) || null : null
    const description = config.fields.description ? pickText(item, config.fields.description) || null : null
    const imageUrl = config.fields.imageUrl
      ? absolutize(pickAttr(item, config.fields.imageUrl, config.fields.imageUrlAttr ?? 'src'), config.baseUrl) || null
      : null
    const priceText = config.fields.priceText ? pickText(item, config.fields.priceText) || null : null

    events.push({ title, url, startsAt, venueName, description, imageUrl, priceText })
  })

  return { events, warnings }
}

function pickText(item: Cheerio<CheerioNode>, selector: string): string {
  return item.find(selector).first().text().trim()
}
function pickAttr(item: Cheerio<CheerioNode>, selector: string, attr: string): string {
  return (item.find(selector).first().attr(attr) ?? '').trim()
}
function parseStartsAt(item: Cheerio<CheerioNode>, config: CSSScraperConfig): Date | null {
  const sel = config.fields.startsAt
  if (!sel) return null
  const node = item.find(sel).first()
  if (!node.length) return null
  const raw = config.fields.startsAtAttr ? node.attr(config.fields.startsAtAttr) : node.text()
  if (!raw) return null
  const ms = Date.parse(raw.trim())
  return Number.isNaN(ms) ? null : new Date(ms)
}
function absolutize(href: string, base?: string): string {
  if (!href) return ''
  if (!base) return href
  try { return new URL(href, base).toString() } catch { return href }
}
