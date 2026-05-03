import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { createLLMClient } from '@uitagenda/llm'

interface InputEvent {
  title: string
  url: string
  startsAt?: string
  description?: string | null
  venueName?: string | null
}

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      url: z.string(),
      isPerennial: z.boolean(),
      reason: z.string(),
    }),
  ),
})

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    allowPositionals: true,
    options: {
      input: { type: 'string' },
    },
  })
  const inputPath = values.input ?? positionals[0]
  if (!inputPath) throw new Error('usage: filter-perennials.ts <events.json>')

  const orKey = process.env.OPENROUTER_API_KEY
  if (!orKey) throw new Error('OPENROUTER_API_KEY missing')

  const raw = JSON.parse(readFileSync(resolve(inputPath), 'utf-8')) as { events: InputEvent[] }
  const events = raw.events
  if (!events?.length) throw new Error('no events in input file')

  const llm = createLLMClient({ apiKey: orKey, appName: 'uitagenda-perennial-filter' })

  console.log(`\n→ classifying ${events.length} events for perennial/recurring noise\n`)
  const t0 = Date.now()

  const { verdicts } = await llm.generateObject({
    task: 'tagging',
    schema: verdictSchema,
    system:
      'You judge whether each "event" is genuinely time-bound (a one-off concert, festival, market, exhibition opening) or perennial/static noise that should be filtered from a daily events digest. Perennial = always-open attractions ("visit our church", "permanent collection"), open-ended weekly/monthly recurrences treated as one entry, generic "things to do" pages, or evergreen listings without a specific date. Time-bound = a single happening tied to a date/time window the user could attend.',
    prompt: [
      'For each event below, return a verdict {url, isPerennial, reason}. Reason ≤ 12 words.',
      '',
      ...events.map((e, i) =>
        `[${i}] title: ${e.title}
    url: ${e.url}
    startsAt: ${e.startsAt ?? '(none)'}
    venue: ${e.venueName ?? '(none)'}
    desc: ${(e.description ?? '').slice(0, 200)}`,
      ),
    ].join('\n'),
  })

  const byUrl = new Map(verdicts.map((v) => [v.url, v]))
  const annotated = events.map((e) => ({
    ...e,
    isPerennial: byUrl.get(e.url)?.isPerennial ?? false,
    reason: byUrl.get(e.url)?.reason ?? 'no verdict',
  }))

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const perennials = annotated.filter((e) => e.isPerennial)
  const keep = annotated.filter((e) => !e.isPerennial)

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = resolve(inputPath).replace(/\.json$/, `.classified-${ts}.json`)
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        sourcePath: inputPath,
        elapsedSec: Number(elapsed),
        counts: { total: events.length, keep: keep.length, perennial: perennials.length },
        keep,
        perennials,
      },
      null,
      2,
    ),
  )

  console.log(`✓ ${events.length} classified in ${elapsed}s | keep: ${keep.length} | perennial: ${perennials.length}`)
  if (perennials.length > 0) {
    console.log(`\n— flagged perennial —`)
    for (const e of perennials.slice(0, 15)) {
      console.log(`  ${e.title}  —  ${e.reason}`)
    }
  }
  console.log(`\nfull output → ${outPath}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
