import { renderDigest, type DigestCadence, type DigestEvent } from '@dolimoyo/email'

export interface SubscriptionLite {
  id: string
  userEmail: string
  locationLabel: string
  cadence: DigestCadence
  lastDigestAt: Date | null
}

// Worker-side query result shape. `description` is the raw scraped text;
// callers fold it into a `blurb` for the email template. Until the worker
// pipeline gains LLM curation (mirroring the local script), the synthesized
// blurb is just a truncated description — good enough for an MVP send loop.
export interface UpcomingEvent {
  eventId: string
  title: string
  url: string
  startsAt: Date
  venueName: string | null
  description: string | null
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
  const { from, to } = digestWindow(args.subscription.cadence, args.now)
  const events = await args.queryEvents({ from, to })

  const digestEvents: DigestEvent[] = events.map((e) => ({
    title: e.title,
    url: e.url,
    startsAt: e.startsAt,
    venueName: e.venueName,
    blurb: e.description ? truncate(e.description, 220) : '',
  }))

  const rendered = await renderDigest({
    locationLabel: args.subscription.locationLabel,
    cadence: args.subscription.cadence,
    referenceDate: args.now,
    events: digestEvents,
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
  cadence: DigestCadence,
  now: Date,
): { from: Date; to: Date } {
  const from = quantizeDay(now)
  if (cadence === 'daily') return { from, to: new Date(from.getTime() + 36 * 60 * 60 * 1000) }
  if (cadence === 'bidaily') return { from, to: new Date(from.getTime() + 2 * 24 * 60 * 60 * 1000) }
  return { from, to: new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000) }
}

export function quantizeDay(d: Date): Date {
  const c = new Date(d)
  c.setUTCHours(0, 0, 0, 0)
  return c
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1).trimEnd() + '…'
}
