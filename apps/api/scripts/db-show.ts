import { resolve } from 'node:path'
import { LocalStore } from './lib/store.ts'

const store = new LocalStore(resolve(import.meta.dirname, '../tmp/store'))
const s = store.summary()

console.log(`\n📦 ${s.path}\n`)
console.log(`  sources:        ${s.sources}`)
console.log(`  events:         ${s.events}`)
console.log(`  discovery runs: ${s.discoveryRuns}`)
console.log(`  extract runs:   ${s.extractRuns}`)
console.log(`  total parsew:   ${s.parsewCalls} calls`)
console.log(`  total llm:      $${s.llmCostUSD.toFixed(4)}\n`)

if (s.byLocation.length > 0) {
  console.log('  by location:')
  for (const loc of s.byLocation.sort((a, b) => b.sources - a.sources)) {
    const noisePct = loc.events > 0 ? ((loc.perennials / loc.events) * 100).toFixed(0) : '0'
    console.log(
      `    ${loc.label.padEnd(20)} ${String(loc.sources).padStart(3)} sources · ${String(loc.events).padStart(4)} events · ${String(loc.perennials).padStart(3)} perennial (${noisePct}%)`,
    )
  }
  console.log()
}
