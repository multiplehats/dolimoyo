import { render } from '@react-email/render'
import { DigestEmail, type DigestCadence, type DigestEmailProps, type DigestEvent } from './templates/DigestEmail'

export interface RenderedDigest { subject: string; html: string; text: string }

// Optional `subject` override lets the curator (LLM) supply a custom subject.
// Falls back to a templated one when absent (e.g. zero-event quiet digest).
export interface RenderDigestArgs extends DigestEmailProps {
  subject?: string
}

export async function renderDigest(args: RenderDigestArgs): Promise<RenderedDigest> {
  const subject = args.subject?.trim() || fallbackSubject(args.cadence, args.locationLabel, args.events.length)

  if (args.events.length === 0) {
    return {
      subject,
      html: `<p>Nothing on the radar in ${escapeHtml(args.locationLabel)}.</p>`,
      text: `Nothing on the radar in ${args.locationLabel}.`,
    }
  }

  const [html, text] = await Promise.all([
    render(DigestEmail(args)),
    render(DigestEmail(args), {
      plainText: true,
      htmlToTextOptions: {
        selectors: [
          { selector: 'h1', options: { uppercase: false } },
          { selector: 'h2', options: { uppercase: false } },
          { selector: 'h3', options: { uppercase: false } },
        ],
      },
    }),
  ])
  return { subject, html, text }
}

function fallbackSubject(cadence: DigestCadence, location: string, count: number): string {
  if (count === 0) return `${location} is quiet`
  if (cadence === 'daily') return `Today & tomorrow in ${location}: ${count} pick${count === 1 ? '' : 's'}`
  if (cadence === 'bidaily') return `Next 48 hours in ${location}: ${count} pick${count === 1 ? '' : 's'}`
  return `This week in ${location}: ${count} pick${count === 1 ? '' : 's'}`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

export type { DigestCadence, DigestEvent, DigestEmailProps }
