import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const RESULTS_DIR = resolve(import.meta.dirname, 'results')
const PRICE = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } // per Mtok, claude-sonnet-4-6
const PARSEW_EXTRACT_USD = 0.025

interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

function cost(u: Usage): number {
  return (
    (u.input_tokens / 1e6) * PRICE.input +
    (u.output_tokens / 1e6) * PRICE.output +
    (u.cache_creation_input_tokens / 1e6) * PRICE.cacheWrite +
    (u.cache_read_input_tokens / 1e6) * PRICE.cacheRead
  )
}

console.log('\nScenario                          A_items A_$    A_s   B_items  B_$     B_s    B_tools')
console.log('────────────────────────────────  ─────── ─────  ────  ───────  ─────  ─────  ───────')

let totalA = 0
let totalB = 0

const ids = readdirSync(RESULTS_DIR)
  .filter((f) => f.endsWith('.pathA.json'))
  .map((f) => f.replace('.pathA.json', ''))
  .sort()

for (const id of ids) {
  const a = JSON.parse(readFileSync(resolve(RESULTS_DIR, `${id}.pathA.json`), 'utf8'))
  const b = JSON.parse(readFileSync(resolve(RESULTS_DIR, `${id}.pathB.json`), 'utf8'))
  const bCost = cost(b.modelUsage as Usage)
  const aCost = (a.parsewCalls ?? 1) * PARSEW_EXTRACT_USD
  totalA += aCost
  totalB += bCost
  console.log(
    `${id.padEnd(32)}  ${String(a.itemCount).padStart(7)}  $${aCost.toFixed(3)}  ${String(Math.round(a.elapsedSec)).padStart(4)}s  ${String(b.itemCount).padStart(7)}  $${bCost.toFixed(3)}  ${String(Math.round(b.elapsedSec)).padStart(4)}s  ${b.toolUses}`,
  )
}

console.log('────────────────────────────────  ─────── ─────  ────  ───────  ─────  ─────  ───────')
console.log(`TOTAL${' '.repeat(33)}        $${totalA.toFixed(3)}              $${totalB.toFixed(3)}`)
