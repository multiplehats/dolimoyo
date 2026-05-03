import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('POST /subscriptions', () => {
  it('rejects missing admin secret with 401', async () => {
    const res = await SELF.fetch('https://x/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('rejects malformed payload with 400', async () => {
    const res = await SELF.fetch('https://x/subscriptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-secret': env.ADMIN_SECRET,
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('rejects trip kind with weekly cadence', async () => {
    const res = await SELF.fetch('https://x/subscriptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-secret': env.ADMIN_SECRET,
      },
      body: JSON.stringify({
        userEmail: 'x@y.com',
        kind: 'trip',
        cadence: 'weekly',
        locationLabel: 'Malaga',
        locationLat: 36.7,
        locationLng: -4.4,
        interests: ['music'],
        endsAt: '2026-06-15T00:00:00Z',
      }),
    })
    expect(res.status).toBe(400)
  })
})
