// Render a personalised digest preview to tmp/. Pipeline:
//   1. pull deduped events for location, in cadence window
//   2. keyword pre-filter by interests (cheap)
//   3. LLM curates: writes intro, picks + blurbs, closer, subject
//   4. render React email + plain text → tmp/

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { locationKey as toLocationKey } from '@dolimoyo/db'
import { createEmailClient, renderDigest, type DigestCadence } from '@dolimoyo/email'
import { createLLMClient } from '@dolimoyo/llm'
import { curateDigest } from '../src/pipeline/curate-digest.ts'
import { dedupeEvents } from './lib/dedupe.ts'
import { rankByInterests } from './lib/relevance.ts'
import { LocalStore } from './lib/store.ts'

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      location: { type: 'string' },
      cadence: { type: 'string', default: 'weekly' },
      interests: { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      includeRecurring: { type: 'boolean', default: false },
      includeUndated: { type: 'boolean', default: false },
      maxCandidates: { type: 'string', default: '40' },
      maxPicks: { type: 'string', default: '8' },
      send: { type: 'boolean', default: false },
    },
  })
  if (!values.location) {
    throw new Error(
      'usage: digest --location X [--cadence daily|bidaily|weekly] [--interests a,b,c] [--email me@x.com] [--name Chris] [--maxCandidates 40] [--maxPicks 8] [--includeRecurring] [--includeUndated]',
    )
  }
  const cadence = parseCadence(values.cadence)
  const interests = (values.interests ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const recipientName = values.name ?? deriveName(values.email)
  const maxCandidates = Number(values.maxCandidates)
  const maxPicks = Number(values.maxPicks)

  const orKey = process.env.OPENROUTER_API_KEY
  if (!orKey) throw new Error('OPENROUTER_API_KEY missing — needed for digest curation')

  const llmCalls: { task: string; costUSD: number }[] = []
  const llm = createLLMClient({
    apiKey: orKey,
    appName: 'dolimoyo-digest',
    onCall: (e) => llmCalls.push({ task: e.task, costUSD: e.costUSD }),
  })

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
  const key = toLocationKey(values.location)

  const now = new Date()
  const from = quantizeDay(now)
  const to = endOfWindow(from, cadence)

  const all = store.listEvents({ locationKey: key })
  const inWindow = all.filter((e) => {
    if (!values.includeRecurring && e.isRecurring) return false
    if (!e.startsAt) return values.includeUndated
    const t = new Date(e.startsAt)
    return t >= from && t < to
  })

  const sources = store.listSources({ locationKey: key })
  const { canonical: deduped, duplicatesRemoved } = dedupeEvents({ events: inWindow, sources })

  // Keyword pre-filter — keeps the LLM input small + skips events with zero
  // interest overlap. If no interests provided, pass everything through.
  const ranked = interests.length > 0
    ? rankByInterests({ events: deduped, interests })
    : deduped.map((e) => ({ ...e, score: 0, matched: [] }))
  const candidates = ranked.slice(0, maxCandidates)

  // Curate with the LLM.
  const curated = await curateDigest({
    recipientName,
    locationLabel: values.location,
    interests,
    cadence,
    referenceDate: now,
    candidates: candidates.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      venueName: e.venueName,
      description: e.description,
      matched: 'matched' in e ? (e as { matched: string[] }).matched : [],
    })),
    llm,
    maxPicks,
  })

  // Stitch curated picks back to event records (preserves curator's order).
  const eventById = new Map(candidates.map((c) => [c.id, c]))
  const display = curated.picks
    .map((p) => {
      const e = eventById.get(p.eventId)
      if (!e) return null
      return {
        title: p.displayTitle?.trim() || e.title,
        url: e.url,
        startsAt: e.startsAt ? new Date(e.startsAt) : null,
        venueName: e.venueName,
        blurb: p.blurb,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const rendered = await renderDigest({
    subject: curated.subject,
    locationLabel: values.location,
    cadence,
    referenceDate: now,
    intro: curated.intro,
    closer: curated.closer,
    events: display,
  })

  const outDir = resolve(import.meta.dirname, '../tmp')
  mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const slug = key || 'digest'
  const htmlPath = resolve(outDir, `digest-${slug}-${cadence}-${ts}.html`)
  const textPath = resolve(outDir, `digest-${slug}-${cadence}-${ts}.txt`)
  writeFileSync(htmlPath, rendered.html)
  writeFileSync(textPath, rendered.text)

  const totalCost = llmCalls.reduce((a, b) => a + b.costUSD, 0)
  const totalCount = all.length
  const filteredOut = totalCount - inWindow.length

  // Optional real send via AutoSend.
  let sentInfo = ''
  if (values.send) {
    if (!values.email) throw new Error('--send requires --email')
    const apiKey = process.env.AUTOSEND_API_KEY
    const fromEmail = process.env.AUTOSEND_DEFAULT_FROM_EMAIL
    const fromName = process.env.AUTOSEND_DEFAULT_FROM_NAME
    const replyTo = process.env.AUTOSEND_REPLY_TO
    if (!apiKey) throw new Error('AUTOSEND_API_KEY missing — required with --send')
    if (!fromEmail) throw new Error('AUTOSEND_DEFAULT_FROM_EMAIL missing — required with --send')
    const email = createEmailClient({ apiKey, fromEmail, fromName, replyTo })
    const sent = await email.send({
      to: values.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    sentInfo = `  sent:     ${sent.id ?? '(no id)'} → ${values.email}`
  }

  console.log(`\n✓ digest preview for ${recipientName} <${values.email ?? '—'}> · ${values.location} · ${cadence}`)
  console.log(`  subject:  ${rendered.subject}`)
  console.log(
    `  events:   ${display.length} picked / ${candidates.length} candidates / ${deduped.length} canonical / ${inWindow.length} in-window / ${duplicatesRemoved} dups / ${filteredOut} out-of-window`,
  )
  console.log(`  llm:      $${totalCost.toFixed(4)} (curation)`)
  console.log(`  html:     ${htmlPath}`)
  console.log(`  text:     ${textPath}`)
  if (sentInfo) console.log(sentInfo)
  console.log(`\n  intro: ${curated.intro}\n`)

  for (const p of curated.picks) {
    const e = eventById.get(p.eventId)
    if (!e) continue
    const when = e.startsAt
      ? new Date(e.startsAt).toISOString().slice(0, 16).replace('T', ' ')
      : '(undated)'
    const titleShown = p.displayTitle?.trim() || e.title
    const titleNote = p.displayTitle?.trim() && p.displayTitle.trim() !== e.title
      ? `  (was: "${e.title.slice(0, 60)}")`
      : ''
    console.log(`  ${when}  ${titleShown}${titleNote}`)
    console.log(`              ↳ ${p.blurb}`)
  }
  console.log(`\n  closer: ${curated.closer}\n`)
}

function parseCadence(s: string | undefined): DigestCadence {
  if (s === 'daily' || s === 'bidaily' || s === 'weekly') return s
  throw new Error(`invalid cadence "${s}" — use daily | bidaily | weekly`)
}

function endOfWindow(from: Date, cadence: DigestCadence): Date {
  const ms = from.getTime()
  if (cadence === 'daily') return new Date(ms + 36 * 60 * 60 * 1000)
  if (cadence === 'bidaily') return new Date(ms + 2 * 24 * 60 * 60 * 1000)
  return new Date(ms + 7 * 24 * 60 * 60 * 1000)
}

function deriveName(email?: string): string {
  if (!email) return 'there'
  const local = email.split('@')[0] ?? ''
  // hi@chrisjayden.com → "Chris" via the domain prefix; fallback to local part.
  const domain = (email.split('@')[1] ?? '').split('.')[0] ?? ''
  const candidate = (domain || local).split(/[-._]/)[0] ?? ''
  if (!candidate) return 'there'
  return candidate.charAt(0).toUpperCase() + candidate.slice(1)
}

function quantizeDay(d: Date): Date {
  const c = new Date(d)
  c.setUTCHours(0, 0, 0, 0)
  return c
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
