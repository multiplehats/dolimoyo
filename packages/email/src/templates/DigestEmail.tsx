import * as React from 'react'
import { Body, Container, Head, Heading, Hr, Html, Link, Section, Text } from '@react-email/components'

export type DigestCadence = 'daily' | 'bidaily' | 'weekly'

export interface DigestEvent {
  title: string
  url: string
  startsAt: Date | null
  venueName: string | null
  // LLM-written one-line blurb explaining why this event fits the recipient.
  // Replaces the old raw `description` field — the curator already saw the
  // description and decided what's worth saying.
  blurb: string
}

export interface DigestEmailProps {
  locationLabel: string
  cadence: DigestCadence
  // Reference time for "today / tomorrow" labelling. Defaults to now.
  referenceDate?: Date
  // LLM-written warm intro paragraph. Falls back to a generic line if absent.
  intro?: string
  // LLM-written closer line.
  closer?: string
  events: DigestEvent[]
}

interface DayBucket {
  label: string
  events: DigestEvent[]
}

export function DigestEmail({ locationLabel, cadence, events, referenceDate, intro, closer }: DigestEmailProps) {
  const ref = referenceDate ?? new Date()
  const buckets = bucketByDay(events, ref, cadence)

  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', color: '#1a1a1a' }}>
        <Container style={{ maxWidth: '560px' }}>
          <Heading as="h1" style={{ fontSize: '22px', margin: '0 0 12px 0' }}>
            {fallbackTitle(cadence, locationLabel, events.length)}
          </Heading>
          {intro ? <Text style={{ margin: '0 0 16px 0', fontSize: '15px', lineHeight: 1.5 }}>{intro}</Text> : null}
          <Hr style={{ borderColor: '#eee' }} />
          {buckets.map((bucket, bi) => (
            <Section key={bi} style={{ marginTop: '20px' }}>
              <Heading as="h2" style={{ fontSize: '13px', margin: '0 0 10px 0', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888' }}>
                {bucket.label}
              </Heading>
              {bucket.events.map((e, ei) => (
                <Section key={ei} style={{ marginBottom: '16px' }}>
                  <Heading as="h3" style={{ fontSize: '17px', margin: 0, lineHeight: 1.3 }}>
                    <Link href={e.url} style={{ color: '#1a1a1a', textDecoration: 'none', borderBottom: '1px solid #1a1a1a' }}>
                      {e.title}
                    </Link>
                  </Heading>
                  <Text style={{ margin: '4px 0', color: '#666', fontSize: '14px' }}>
                    {formatTime(e.startsAt)}
                    {e.venueName ? ` · ${e.venueName}` : ''}
                  </Text>
                  {e.blurb ? (
                    <Text style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#333', lineHeight: 1.5 }}>
                      {e.blurb}
                    </Text>
                  ) : null}
                </Section>
              ))}
            </Section>
          ))}
          {closer ? (
            <>
              <Hr style={{ borderColor: '#eee', marginTop: '24px' }} />
              <Text style={{ marginTop: '16px', fontSize: '15px' }}>{closer}</Text>
            </>
          ) : null}
          <Text style={{ color: '#999', fontSize: '12px', marginTop: '20px' }}>
            dolimoyo · {locationLabel} · {labelForCadence(cadence)}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

function bucketByDay(events: DigestEvent[], ref: Date, cadence: DigestCadence): DayBucket[] {
  const refDay = startOfUTCDay(ref)
  const undated: DigestEvent[] = []
  const byDay = new Map<number, DigestEvent[]>()
  for (const e of events) {
    if (!e.startsAt) {
      undated.push(e)
      continue
    }
    const key = startOfUTCDay(e.startsAt).getTime()
    const bucket = byDay.get(key) ?? []
    bucket.push(e)
    byDay.set(key, bucket)
  }
  const out: DayBucket[] = []
  for (const [ts, bucket] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const offsetDays = Math.round((ts - refDay.getTime()) / 86_400_000)
    out.push({ label: dayLabel(new Date(ts), offsetDays, cadence), events: bucket })
  }
  if (undated.length > 0) out.push({ label: 'Date TBA', events: undated })
  return out
}

function dayLabel(d: Date, offsetDays: number, cadence: DigestCadence): string {
  if (offsetDays === 0) return 'Today'
  if (offsetDays === 1) return 'Tomorrow'
  if (cadence === 'weekly' || offsetDays > 1 || offsetDays < 0) {
    return d.toLocaleDateString('en-NL', { weekday: 'long', day: 'numeric', month: 'short' })
  }
  return d.toLocaleDateString('en-NL', { weekday: 'long' })
}

function fallbackTitle(cadence: DigestCadence, location: string, count: number): string {
  if (count === 0) return `${location} is quiet`
  if (cadence === 'daily') return `Today & tomorrow in ${location}`
  if (cadence === 'bidaily') return `Next 48 hours in ${location}`
  return `This week in ${location}`
}

function labelForCadence(cadence: DigestCadence): string {
  if (cadence === 'daily') return 'daily digest'
  if (cadence === 'bidaily') return 'every-other-day digest'
  return 'weekly digest'
}

function formatTime(d: Date | null): string {
  if (!d) return ''
  const hh = d.getUTCHours().toString().padStart(2, '0')
  const mm = d.getUTCMinutes().toString().padStart(2, '0')
  if (hh === '00' && mm === '00') return 'all day'
  return `${hh}:${mm}`
}

function startOfUTCDay(d: Date): Date {
  const c = new Date(d)
  c.setUTCHours(0, 0, 0, 0)
  return c
}
