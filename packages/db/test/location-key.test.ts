import { describe, expect, it } from 'vitest'
import { locationKey } from '../src/location-key'

describe('locationKey', () => {
  it('lowercases and slugifies', () => {
    expect(locationKey('Enschede')).toBe('enschede')
    expect(locationKey('Den Haag')).toBe('den-haag')
  })

  it('strips diacritics', () => {
    expect(locationKey('Málaga')).toBe('malaga')
    expect(locationKey('Köln')).toBe('koln')
  })

  it('collapses commas, country suffixes, and surrounding whitespace', () => {
    expect(locationKey('Enschede, NL')).toBe('enschede-nl')
    expect(locationKey('  Enschede  ')).toBe('enschede')
    expect(locationKey('São Paulo, Brazil')).toBe('sao-paulo-brazil')
  })

  it('is idempotent', () => {
    const once = locationKey('Enschede, NL')
    expect(locationKey(once)).toBe(once)
  })
})
