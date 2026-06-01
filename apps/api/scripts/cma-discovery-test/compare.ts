import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCENARIOS } from './scenarios.ts'
import type { PathAResult } from './pathA.ts'
import type { PathBResult } from './pathB.ts'

const RESULTS_DIR = resolve(import.meta.dirname, 'results')

function loadJsonOptional<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(resolve(RESULTS_DIR, name), 'utf8')) as T
  } catch {
    return null
  }
}

function normalizeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function main() {
  for (const scenario of SCENARIOS) {
    const a = loadJsonOptional<PathAResult>(`${scenario.id}.pathA.json`)
    const b = loadJsonOptional<PathBResult>(`${scenario.id}.pathB.json`)
    console.log(`\n════════ ${scenario.label} (${scenario.id}) ════════`)

    if (!a) console.log('  Path A: missing')
    if (!b) console.log('  Path B: missing')
    if (!a || !b) continue

    const aDomains = new Map<string, { url: string; score: number }>()
    for (const s of a.sources) aDomains.set(normalizeDomain(s.listingUrl), { url: s.listingUrl, score: s.score })

    const bDomains = new Map<string, { url: string; reason: string; freshness: string }>()
    for (const c of b.candidates) {
      bDomains.set(normalizeDomain(c.url), {
        url: c.url,
        reason: c.reason,
        freshness: c.freshness_evidence,
      })
    }

    const allDomains = new Set([...aDomains.keys(), ...bDomains.keys()])
    const onlyA: string[] = []
    const onlyB: string[] = []
    const both: string[] = []
    for (const d of allDomains) {
      if (aDomains.has(d) && bDomains.has(d)) both.push(d)
      else if (aDomains.has(d)) onlyA.push(d)
      else onlyB.push(d)
    }

    const aCost = (a.parsewCostUSDEstimate ?? 0) + (a.llmCostUSD ?? 0)
    console.log(`\nCounts: A=${a.sources.length} B=${b.candidates.length} | overlap=${both.length} only-A=${onlyA.length} only-B=${onlyB.length}`)
    console.log(`Cost:   A≈$${aCost.toFixed(4)} (${a.elapsedSec.toFixed(1)}s)  |  B: see usage log (${b.elapsedSec.toFixed(1)}s, ${b.toolUses.length} tool calls, finish=${b.finishedReason})`)

    console.log(`\nOverlap (${both.length}):`)
    for (const d of both) console.log(`  · ${d}`)
    console.log(`\nOnly in Path A — current pipeline (${onlyA.length}):`)
    for (const d of onlyA) {
      const item = aDomains.get(d)!
      console.log(`  · ${item.score.toFixed(1)}  ${item.url}`)
    }
    console.log(`\nOnly in Path B — managed agent (${onlyB.length}):`)
    for (const d of onlyB) {
      const item = bDomains.get(d)!
      console.log(`  · ${item.url}`)
      console.log(`        reason: ${item.reason}`)
      console.log(`        evidence: ${item.freshness}`)
    }
  }
  console.log('')
}

main()
