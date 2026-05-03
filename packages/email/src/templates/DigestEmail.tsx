import { Body, Container, Head, Heading, Hr, Html, Link, Section, Text } from '@react-email/components'

export interface DigestEvent {
  title: string
  url: string
  startsAt: Date | null
  venueName: string | null
  description: string | null
}

export interface DigestEmailProps {
  locationLabel: string
  windowLabel: string
  events: DigestEvent[]
}

export function DigestEmail({ locationLabel, windowLabel, events }: DigestEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, sans-serif', padding: '24px' }}>
        <Container>
          <Heading as="h1">{locationLabel} — {windowLabel}</Heading>
          <Text>{events.length} events worth knowing about.</Text>
          <Hr />
          {events.map((e, i) => (
            <Section key={i} style={{ marginBottom: '20px' }}>
              <Heading as="h2" style={{ fontSize: '18px', margin: 0 }}>
                <Link href={e.url}>{e.title}</Link>
              </Heading>
              <Text style={{ margin: '4px 0', color: '#555' }}>
                {formatWhen(e.startsAt)}
                {e.venueName ? ` · ${e.venueName}` : ''}
              </Text>
              {e.description ? <Text style={{ margin: 0 }}>{e.description}</Text> : null}
            </Section>
          ))}
        </Container>
      </Body>
    </Html>
  )
}

function formatWhen(d: Date | null): string {
  if (!d) return 'Date TBA'
  return d.toLocaleString('en-NL', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
