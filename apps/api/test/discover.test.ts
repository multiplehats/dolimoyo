import { describe, expect, it, vi } from 'vitest'
import { discoverSources } from '../src/pipeline/discover'

describe('discoverSources', () => {
  it('searches, drops blocklist, maps to find listing URLs, scores, returns top N', async () => {
    const parsew = {
      search: vi.fn().mockResolvedValue({
        results: [
          { url: 'https://uitinenschede.nl/', title: 'Uit in Enschede' },
          { url: 'https://eventbrite.com/d/enschede', title: 'Eventbrite' }, // blocklisted
          { url: 'https://visittwente.nl/', title: 'Visit Twente' },
          { url: 'https://facebook.com/events', title: 'Facebook' }, // blocklisted
        ],
      }),
      map: vi
        .fn()
        .mockResolvedValueOnce({ links: ['https://uitinenschede.nl/agenda', 'https://uitinenschede.nl/about'] })
        .mockResolvedValueOnce({ links: ['https://visittwente.nl/uitagenda'] }),
    }
    const llm = {
      generateObject: vi.fn().mockResolvedValue({
        scores: [
          { url: 'https://uitinenschede.nl/agenda', score: 9 },
          { url: 'https://visittwente.nl/uitagenda', score: 8 },
        ],
      }),
    }

    const result = await discoverSources({
      location: { label: 'Enschede', lat: 52.22, lng: 6.89, radiusKm: 25 },
      interests: ['music', 'arts'],
      language: 'nl',
      parsew: parsew as never,
      llm: llm as never,
      topN: 5,
    })

    expect(parsew.search).toHaveBeenCalled()
    expect(parsew.map).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)
    expect(result[0]?.listingUrl).toBe('https://uitinenschede.nl/agenda')
    expect(result[0]?.score).toBe(9)
    expect(result[1]?.listingUrl).toBe('https://visittwente.nl/uitagenda')
  })

  it('returns empty when search yields nothing usable', async () => {
    const parsew = {
      search: vi.fn().mockResolvedValue({ results: [{ url: 'https://eventbrite.com/x', title: 'eb' }] }),
      map: vi.fn(),
    }
    const llm = { generateObject: vi.fn() }
    const result = await discoverSources({
      location: { label: 'Enschede', lat: 52.22, lng: 6.89, radiusKm: 25 },
      interests: ['music'],
      language: 'nl',
      parsew: parsew as never,
      llm: llm as never,
      topN: 5,
    })
    expect(result).toEqual([])
    expect(llm.generateObject).not.toHaveBeenCalled()
  })

  it('drops candidates whose map returns no listing-shaped URLs', async () => {
    const parsew = {
      search: vi.fn().mockResolvedValue({ results: [{ url: 'https://broken.nl/', title: 'broken' }] }),
      map: vi.fn().mockResolvedValue({ links: [] }),
    }
    const llm = { generateObject: vi.fn() }
    const result = await discoverSources({
      location: { label: 'Enschede', lat: 52.22, lng: 6.89, radiusKm: 25 },
      interests: ['music'],
      language: 'nl',
      parsew: parsew as never,
      llm: llm as never,
      topN: 5,
    })
    expect(result).toEqual([])
    expect(llm.generateObject).not.toHaveBeenCalled()
  })
})
