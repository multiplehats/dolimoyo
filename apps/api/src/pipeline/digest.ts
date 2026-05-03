import { renderDigest, type DigestEvent } from '@uitagenda/email'

export interface SubscriptionLite {
  id: string
  userEmail: string
  locationLabel: string
  cadence: 'daily' | 'weekly'
  lastDigestAt: Date | null
}

export interface UpcomingEvent extends DigestEvent {
  eventId: string
}

export interface SendDigestArgs {
  subscription: SubscriptionLite
  now: Date
  queryEvents: (range: { from: Date; to: Date }) => Promise<UpcomingEvent[]>
  sendEmail: (msg: { to: string; subject: string; html: string; text: string }) => Promise<{ id: string | null }>
  recordRun: (run: {
    subscriptionId: string
    windowStart: Date
    windowEnd: Date
    eventIds: string[]
    autosendId: string | null
    deliveryStatus: 'sent' | 'failed'
  }) => Promise<void>
}

export async function sendDigestForSubscription(args: SendDigestArgs): Promise<void> {
  const { from, to, label } = digestWindow(args.subscription.cadence, args.now)
  const events = await args.queryEvents({ from, to })

  const rendered = await renderDigest({
    locationLabel: args.subscription.locationLabel,
    windowLabel: label,
    events: events.map((e) => ({
      title: e.title, url: e.url, startsAt: e.startsAt,
      venueName: e.venueName, description: e.description,
    })),
  })

  let sent: { id: string | null } = { id: null }
  let status: 'sent' | 'failed' = 'sent'
  try {
    sent = await args.sendEmail({
      to: args.subscription.userEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
  } catch (err) {
    status = 'failed'
    console.error('digest send failed', err)
  }

  await args.recordRun({
    subscriptionId: args.subscription.id,
    windowStart: from,
    windowEnd: to,
    eventIds: events.map((e) => e.eventId),
    autosendId: sent.id,
    deliveryStatus: status,
  })
}

export function digestWindow(
  cadence: 'daily' | 'weekly',
  now: Date,
): { from: Date; to: Date; label: string } {
  if (cadence === 'daily') {
    const from = quantizeDay(now)
    const to = new Date(from.getTime() + 36 * 60 * 60 * 1000)
    return { from, to, label: 'today' }
  }
  const from = quantizeDay(now)
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { from, to, label: 'this week' }
}

export function quantizeDay(d: Date): Date {
  const c = new Date(d)
  c.setUTCHours(0, 0, 0, 0)
  return c
}
