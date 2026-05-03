import { describe, expect, it, vi } from 'vitest'
import { createParsewClient } from '../src/client'

describe('createParsewClient', () => {
  it('throws if api key is missing', () => {
    expect(() => createParsewClient({ apiKey: '' })).toThrow(/api key/i)
  })

  it('retries scrape once on 5xx and calls onCall ledger hook on success', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ markdown: '', html: '<p>ok</p>', links: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    const original = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const onCall = vi.fn()
    try {
      const client = createParsewClient({ apiKey: 'sr_test', maxRetries: 1, onCall })
      const result = await client.scrape('https://example.com')
      expect(result.html).toBe('<p>ok</p>')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(onCall).toHaveBeenCalledWith({ endpoint: 'scrape', costUnits: 1 })
    } finally {
      globalThis.fetch = original
    }
  })

  it('search() POSTs to /v1/search and records cost', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ results: [{ url: 'https://x', title: 't' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const original = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const onCall = vi.fn()
    try {
      const client = createParsewClient({ apiKey: 'sr_test', onCall })
      const r = await client.search('events Enschede', { limit: 5, lang: 'nl' })
      expect(r.results).toHaveLength(1)
      const call = fetchMock.mock.calls[0]
      const url = String(call?.[0])
      expect(url.endsWith('/v1/search')).toBe(true)
      const init = call?.[1] as RequestInit
      expect(init.method).toBe('POST')
      const body = JSON.parse(String(init.body))
      expect(body.query).toBe('events Enschede')
      expect(body.limit).toBe(5)
      expect(body.lang).toBe('nl')
      expect(onCall).toHaveBeenCalledWith({ endpoint: 'search', costUnits: 1 })
    } finally {
      globalThis.fetch = original
    }
  })
})
