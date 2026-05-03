import { render } from '@react-email/render'
import { DigestEmail, type DigestEmailProps, type DigestEvent } from './templates/DigestEmail'

export interface RenderedDigest { subject: string; html: string; text: string }

export async function renderDigest(props: DigestEmailProps): Promise<RenderedDigest> {
  const subject =
    props.events.length === 0
      ? `${props.locationLabel} is quiet — ${props.windowLabel}`
      : `${props.events.length} in ${props.locationLabel} — ${props.windowLabel}`

  if (props.events.length === 0) {
    return {
      subject,
      html: `<p>Nothing on the radar in ${escapeHtml(props.locationLabel)} ${escapeHtml(props.windowLabel)}.</p>`,
      text: `Nothing on the radar in ${props.locationLabel} ${props.windowLabel}.`,
    }
  }

  const [html, text] = await Promise.all([
    render(DigestEmail(props)),
    render(DigestEmail(props), {
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

export type { DigestEvent, DigestEmailProps }
