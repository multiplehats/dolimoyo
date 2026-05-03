import { describe, expect, it } from 'vitest'
import { renderDigest } from '../src/render'

describe('renderDigest', () => {
  it('produces html, text, subject', async () => {
    const out = await renderDigest({
      locationLabel: 'Enschede',
      windowLabel: 'today',
      events: [{
        title: 'Festival One',
        url: 'https://x/y',
        startsAt: new Date('2026-06-01T20:00:00Z'),
        venueName: 'Stadsweide',
        description: 'A great show',
      }],
    })
    expect(out.subject).toContain('Enschede')
    expect(out.html).toContain('Festival One')
    expect(out.text).toContain('Festival One')
    expect(out.text).toContain('Stadsweide')
  })

  it('handles zero events with a graceful subject', async () => {
    const out = await renderDigest({ locationLabel: 'Enschede', windowLabel: 'today', events: [] })
    expect(out.subject.toLowerCase()).toContain('quiet')
    expect(out.html).toContain('Nothing')
  })
})
