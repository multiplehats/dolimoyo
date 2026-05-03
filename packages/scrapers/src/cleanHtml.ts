import * as cheerio from 'cheerio'

// Strip noise from HTML before sending to an LLM for selector generation.
// Removes scripts, styles, svgs, comments, and chatty attributes that bloat
// tokens without helping the LLM identify event-listing structure.
export function cleanHtml(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg, iframe, link, meta').remove()
  // Drop comments.
  $('*')
    .contents()
    .each((_, n) => {
      if (n.type === 'comment') $(n).remove()
    })
  // Remove unhelpful attributes (preserve href/src/datetime/class/id which the
  // LLM uses to write selectors and the runner uses to extract data).
  const KEEP = new Set(['href', 'src', 'datetime', 'class', 'id', 'alt', 'title'])
  $('*').each((_, el) => {
    if (el.type !== 'tag') return
    const attribs = el.attribs
    for (const name of Object.keys(attribs)) {
      if (!KEEP.has(name)) delete attribs[name]
    }
  })
  // Collapse whitespace runs that don't change selector semantics.
  return $.html().replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}
