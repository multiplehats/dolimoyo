import { describe, expect, it } from 'vitest'
import { looksPlausible } from '../src/plausibility'
import type { ScrapedEvent } from '../src/types'

const ev = (overrides: Partial<ScrapedEvent> = {}): ScrapedEvent => ({
  title: 'Some Event',
  url: 'https://example.com/x',
  startsAt: new Date('2026-06-01T00:00:00Z'),
  rawStartsAt: null,
  venueName: 'Some Venue',
  description: null,
  imageUrl: null,
  priceText: null,
  ...overrides,
})

describe('looksPlausible', () => {
  it('returns true when ≥3 events have title + url + startsAt and titles are mostly distinct', () => {
    expect(looksPlausible([ev({ title: 'A' }), ev({ title: 'B' }), ev({ title: 'C' })])).toBe(true)
  })
  it('returns false when fewer than 3 events', () => {
    expect(looksPlausible([ev(), ev()])).toBe(false)
  })
  it('returns false when most events have null startsAt', () => {
    expect(looksPlausible([ev({ startsAt: null }), ev({ startsAt: null }), ev({ startsAt: null })])).toBe(false)
  })
  it('returns false when titles are all identical', () => {
    expect(looksPlausible([ev({ title: 'X' }), ev({ title: 'X' }), ev({ title: 'X' })])).toBe(false)
  })
})
