// Diagnostic: print plain-vs-JS-rendered body text length for a URL.
// Used to validate the SPA-shell heuristic against real sites.

import { parseArgs } from 'node:util'
import { bodyTextLength } from '@uitagenda/scrapers'
import { createParsewClient } from '@uitagenda/parsew'

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      url: { type: 'string' },
      waitFor: { type: 'string', default: '3000' },
    },
  })
  if (!values.url) throw new Error('usage: probe-spa --url <url> [--waitFor 3000]')
  const apiKey = process.env.PARSEW_API_KEY
  if (!apiKey) throw new Error('PARSEW_API_KEY missing')
  const parsew = createParsewClient({ apiKey, baseUrl: process.env.PARSEW_BASE_URL })

  console.log(`\n→ probing ${values.url}\n`)

  const t1 = Date.now()
  const plain = await parsew.scrape(values.url)
  const plainText = bodyTextLength(plain.html)
  const plainSec = ((Date.now() - t1) / 1000).toFixed(1)
  console.log(`plain        : ${plain.html.length}B html · ${plainText}B body text · ${plainSec}s`)

  const t2 = Date.now()
  const js = await parsew.scrape(values.url, { waitFor: Number(values.waitFor) })
  const jsText = bodyTextLength(js.html)
  const jsSec = ((Date.now() - t2) / 1000).toFixed(1)
  console.log(`waitFor=${values.waitFor}ms : ${js.html.length}B html · ${jsText}B body text · ${jsSec}s`)

  const ratio = plainText > 0 ? (jsText / plainText).toFixed(1) : 'N/A'
  console.log(`\nratio js/plain text: ${ratio}x`)
  console.log(`SPA shell? ${plainText < 600 ? 'YES (plain < 600B)' : 'no'}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
