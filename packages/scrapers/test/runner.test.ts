import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCSSScraper } from '../src/runner'
import type { CSSScraperConfig } from '../src/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../__fixtures__', name), 'utf-8')

describe('runCSSScraper', () => {
  it('extracts events from a simple listing page', () => {
    const html = fixture('simple-listing.html')
    const config: CSSScraperConfig = {
      itemSelector: '.event',
      baseUrl: 'https://example.com',
      fields: {
        title: '.title',
        url: 'a.detail',
        startsAt: 'time',
        startsAtAttr: 'datetime',
        venueName: '.venue',
        description: '.desc',
      },
    }
    const result = runCSSScraper(html, config)
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toEqual({
      title: 'Festival One',
      url: 'https://example.com/events/one',
      startsAt: new Date('2026-06-01T20:00:00Z'),
      rawStartsAt: '2026-06-01T20:00:00Z',
      venueName: 'Stadsweide',
      description: 'A great show',
      imageUrl: null,
      priceText: null,
    })
  })

  it('returns empty when itemSelector matches nothing', () => {
    const result = runCSSScraper('<html></html>', {
      itemSelector: '.nope',
      fields: { title: 'h1', url: 'a' },
    })
    expect(result.events).toEqual([])
  })

  it('skips items missing required fields and warns', () => {
    const html =
      '<div class="event"><a class="detail" href="/x">no title</a></div>' +
      '<div class="event"><h2 class="title">ok</h2><a class="detail" href="/y">link</a></div>'
    const result = runCSSScraper(html, {
      itemSelector: '.event',
      baseUrl: 'https://example.com',
      fields: { title: '.title', url: 'a.detail' },
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.title).toBe('ok')
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
