// Render a digest preview to tmp/digest-<location>-<ts>.html. No email sent.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { locationKey as toLocationKey } from '@uitagenda/db'
import { renderDigest } from '@uitagenda/email'
import { dedupeEvents } from './lib/dedupe.ts'
import { LocalStore } from './lib/store.ts'

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      location: { type: 'string' },
      cadence: { type: 'string', default: 'weekly' },
      includeRecurring: { type: 'boolean', default: false },
      includeUndated: { type: 'boolean', default: false },
    },
  })
  if (!values.location) throw new Error('usage: digest --location X [--cadence daily|weekly] [--includeRecurring] [--includeUndated]')
  const cadence = values.cadence === 'daily' ? 'daily' : 'weekly'

  const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
  const key = toLocationKey(values.location)

  const now = new Date()
  const from = quantizeDay(now)
  const to =
    cadence === 'daily'
      ? new Date(from.getTime() + 36 * 60 * 60 * 1000)
      : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000)
  const label = cadence === 'daily' ? 'today' : 'this week'

  const all = store.listEvents({ locationKey: key })
  const inWindow = all.filter((e) => {
    if (!values.includeRecurring && e.isRecurring) return false
    if (!e.startsAt) return values.includeUndated
    const t = new Date(e.startsAt)
    return t >= from && t < to
  })

  const sources = store.listSources({ locationKey: key })
  const { canonical: deduped, duplicatesRemoved } = dedupeEvents({ events: inWindow, sources })
  deduped.sort((a, b) => {
    const ta = a.startsAt ? new Date(a.startsAt).getTime() : Number.POSITIVE_INFINITY
    const tb = b.startsAt ? new Date(b.startsAt).getTime() : Number.POSITIVE_INFINITY
    return ta - tb
  })

  const rendered = await renderDigest({
    locationLabel: values.location,
    windowLabel: label,
    events: deduped.map((e) => ({
      title: e.title,
      url: e.url,
      startsAt: e.startsAt ? new Date(e.startsAt) : null,
      venueName: e.venueName,
      description: e.description,
    })),
  })

  const outDir = resolve(import.meta.dirname, '../tmp')
  mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const slug = key || 'digest'
  const htmlPath = resolve(outDir, `digest-${slug}-${ts}.html`)
  const textPath = resolve(outDir, `digest-${slug}-${ts}.txt`)
  writeFileSync(htmlPath, rendered.html)
  writeFileSync(textPath, rendered.text)

  const totalCount = all.length
  const filteredOut = totalCount - inWindow.length
  console.log(`\n✓ digest preview for ${values.location} (${label})`)
  console.log(`  events:   ${deduped.length} (${inWindow.length} in-window before dedup, ${duplicatesRemoved} cross-source duplicates removed, ${filteredOut} out-of-window/perennial/undated)`)
  console.log(`  subject:  ${rendered.subject}`)
  console.log(`  html:     ${htmlPath}`)
  console.log(`  text:     ${textPath}\n`)

  for (const e of deduped.slice(0, 10)) {
    const when = e.startsAt ? new Date(e.startsAt).toISOString().slice(0, 16).replace('T', ' ') : '(undated)'
    console.log(`  ${when}  ${e.title}`)
  }
  if (deduped.length > 10) console.log(`  …and ${deduped.length - 10} more`)
  console.log()
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
