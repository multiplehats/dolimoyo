import { describe, expect, it, vi } from 'vitest'
import { generateScraper } from '../src/pipeline/generate-scraper'
import type { CSSScraperConfig } from '@dolimoyo/scrapers'

const fixtureHtml = `
  <html><body>
    <article class="evt"><h3 class="ttl">A</h3><a class="lnk" href="/a">link</a><time datetime="2026-06-01T00:00:00Z">x</time></article>
    <article class="evt"><h3 class="ttl">B</h3><a class="lnk" href="/b">link</a><time datetime="2026-06-02T00:00:00Z">x</time></article>
    <article class="evt"><h3 class="ttl">C</h3><a class="lnk" href="/c">link</a><time datetime="2026-06-03T00:00:00Z">x</time></article>
  </body></html>
`

const validConfig: CSSScraperConfig = {
  itemSelector: 'article.evt',
  baseUrl: 'https://example.test',
  fields: { title: '.ttl', url: 'a.lnk', startsAt: 'time', startsAtAttr: 'datetime' },
}

describe('generateScraper', () => {
  it('returns a config that produces ≥3 plausible events on first try', async () => {
    const llm = { generateObject: vi.fn().mockResolvedValueOnce(validConfig) }
    const result = await generateScraper({
      html: fixtureHtml,
      baseUrl: 'https://example.test',
      llm: llm as never,
    })
    expect(result.kind).toBe('css')
    if (result.kind === 'css') expect(result.config).toEqual(validConfig)
    expect(llm.generateObject).toHaveBeenCalledTimes(1)
  })

  it('retries with feedback when first config fails validation', async () => {
    const broken: CSSScraperConfig = { itemSelector: '.does-not-exist', fields: { title: 'h1', url: 'a' } }
    const llm = {
      generateObject: vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(validConfig),
    }
    const result = await generateScraper({
      html: fixtureHtml,
      baseUrl: 'https://example.test',
      llm: llm as never,
    })
    expect(result.kind).toBe('css')
    expect(llm.generateObject).toHaveBeenCalledTimes(2)
  })

  it('falls back to extract kind after maxAttempts of CSS failures', async () => {
    const broken: CSSScraperConfig = { itemSelector: '.does-not-exist', fields: { title: 'h1', url: 'a' } }
    const llm = { generateObject: vi.fn().mockResolvedValue(broken) }
    const result = await generateScraper({
      html: fixtureHtml,
      baseUrl: 'https://example.test',
      llm: llm as never,
      maxAttempts: 2,
    })
    expect(result.kind).toBe('extract')
    expect(llm.generateObject).toHaveBeenCalledTimes(2)
  })
})
