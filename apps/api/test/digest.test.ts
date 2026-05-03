import { describe, expect, it, vi } from 'vitest'
import { sendDigestForSubscription } from '../src/pipeline/digest'

describe('sendDigestForSubscription', () => {
  it('queries upcoming events, renders, sends, records run', async () => {
    const queryEvents = vi.fn().mockResolvedValue([{
      eventId: 'ev_1', title: 'Festival', url: 'https://x/y',
      startsAt: new Date('2026-06-01T20:00:00Z'),
      venueName: 'Stadsweide', description: 'great show',
    }])
    const sendEmail = vi.fn().mockResolvedValue({ id: 'as_123' })
    const recordRun = vi.fn().mockResolvedValue(undefined)

    await sendDigestForSubscription({
      subscription: {
        id: 'sub_1', userEmail: 'hi@chrisjayden.com', locationLabel: 'Enschede',
        cadence: 'daily', lastDigestAt: null,
      },
      now: new Date('2026-05-31T06:00:00Z'),
      queryEvents, sendEmail, recordRun,
    })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_1', eventIds: ['ev_1'],
        autosendId: 'as_123', deliveryStatus: 'sent',
      }),
    )
  })

  it('still sends "quiet" digest when zero events', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ id: 'as_124' })
    const recordRun = vi.fn().mockResolvedValue(undefined)
    await sendDigestForSubscription({
      subscription: {
        id: 'sub_1', userEmail: 'hi@chrisjayden.com', locationLabel: 'Enschede',
        cadence: 'daily', lastDigestAt: null,
      },
      now: new Date('2026-05-31T06:00:00Z'),
      queryEvents: vi.fn().mockResolvedValue([]),
      sendEmail, recordRun,
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(recordRun).toHaveBeenCalled()
  })
})
