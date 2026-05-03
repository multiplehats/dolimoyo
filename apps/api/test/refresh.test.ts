import { describe, expect, it, vi } from 'vitest'
import { refreshSource } from '../src/pipeline/refresh'
import type { CSSScraperConfig } from '@uitagenda/scrapers'

const cssConfig: CSSScraperConfig = {
  itemSelector: '.event',
  baseUrl: 'https://example.test',
  fields: { title: '.title', url: 'a', startsAt: 'time', startsAtAttr: 'datetime' },
}

const html = `
  <div class="event"><h2 class="title">A</h2><a href="/a">link</a><time datetime="2026-06-01T00:00:00Z">x</time></div>
  <div class="event"><h2 class="title">B</h2><a href="/b">link</a><time datetime="2026-06-02T00:00:00Z">x</time></div>
  <div class="event"><h2 class="title">C</h2><a href="/c">link</a><time datetime="2026-06-03T00:00:00Z">x</time></div>
`

describe('refreshSource', () => {
  it('CSS path: scrape, parse, upsert; returns events', async () => {
    const parsew = { scrape: vi.fn().mockResolvedValue({ html, markdown: '', links: [] }), extract: vi.fn() }
    const upsert = vi.fn().mockResolvedValue(undefined)
    const result = await refreshSource({
      sourceId: 'src_1',
      listingUrl: 'https://example.test/',
      language: 'nl',
      scraper: { kind: 'css', config: cssConfig },
      parsew: parsew as never,
      upsertEvents: upsert,
    })
    expect(parsew.scrape).toHaveBeenCalled()
    expect(parsew.extract).not.toHaveBeenCalled()
    expect(result.path).toBe('css')
    expect(result.fellBackToExtract).toBe(false)
  })

  it('falls back to extract when CSS path returns implausible events', async () => {
    const brokenConfig: CSSScraperConfig = { itemSelector: '.nope', fields: { title: 'h1', url: 'a' } }
    const parsew = {
      scrape: vi.fn().mockResolvedValue({ html, markdown: '', links: [] }),
      extract: vi.fn().mockResolvedValue({
        data: {
          events: [
            { title: 'X', url: 'https://example.test/x', startsAt: '2026-06-01T00:00:00Z' },
            { title: 'Y', url: 'https://example.test/y', startsAt: '2026-06-02T00:00:00Z' },
            { title: 'Z', url: 'https://example.test/z', startsAt: '2026-06-03T00:00:00Z' },
          ],
        },
      }),
    }
    const upsert = vi.fn().mockResolvedValue(undefined)
    const result = await refreshSource({
      sourceId: 'src_1',
      listingUrl: 'https://example.test/',
      language: 'nl',
      scraper: { kind: 'css', config: brokenConfig },
      parsew: parsew as never,
      upsertEvents: upsert,
    })
    expect(parsew.extract).toHaveBeenCalled()
    expect(result.path).toBe('extract')
    expect(result.fellBackToExtract).toBe(true)
  })
})
