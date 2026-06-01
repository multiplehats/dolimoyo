# CMA vs Parsew scraping — findings

Test setup: 6 URLs × 2 paths.
Path A = `parsew.extract(url, { schema, prompt })` — single API call, Parsew fetches + LLM-extracts.
Path B = Claude Managed Agent (claude-sonnet-4-6 + `agent_toolset_20260401`, cloud sandbox, 3-min timeout). Single session per URL.

## Headline

| URL | A items | B items | Verdict |
|---|---:|---:|---|
| visittwente.nl/agenda/ (control, NL events) | **0** | **38** | **Path B wins** — surprise: a "control" URL where Parsew returned zero |
| metropool.nl/agenda (NL venue) | 10 | 10 | Tie — identical sample titles |
| fashionunited.uk/fashion-jobs | 26 | 25 | Tie on count; different jobs surfaced |
| fashionworkplace.com/jobs (Vercel SPA) | 20 | 20 | Tie — identical sample titles |
| drapersjobs.com/jobs (3.7KB raw HTML) | **0** | **20** | **Path B wins** — Parsew can't crack it; CMA gets 20 jobs in one fetch |
| fashionnetwork.com/jobs/ (Cloudflare wall) | 0 | 0 | Both lose — neither bypasses Cloudflare |

| | Path A | Path B |
|---|---:|---:|
| Total cost | $0.150 | $0.564 |
| Total wall time | 49s | 338s (5.6m) |
| Per-URL cost | flat $0.025 (1 extract call each) | $0.017–$0.243, scales with tool use |

## Per-URL details

### visittwente.nl/agenda/ — Path B wins 38 to 0
Parsew returned `items: []` in 6s. Cause not directly visible — the extract call succeeded (no error), schema-shaped the response, but pulled zero entries. The URL is a 301 redirect; Parsew likely followed it but the destination didn't yield extract-shaped content.

Path B made **7 tool calls** to assemble 38 events:
- `web_fetch /agenda/` → **`url_not_accessible`** (same 301 issue that breaks Parsew)
- `web_fetch /agenda/` no-www → also **`url_not_accessible`**
- `web_search "site:visittwente.nl agenda events 2025"` ✓ surfaced sub-URLs
- `web_fetch /wat-te-doen/evenementen-juni/` ✓
- `web_fetch /wat-te-doen/evenementen-juli/` ✓
- `web_fetch /uitagenda/vandaag/` ✓
- `web_fetch /agenda-item/155650/nacht-van-hengelo/` → **`url_not_accessible`**

The agent failed on the same URL Parsew failed on, then **web_searched, found alternate sub-URLs on the same domain, and aggregated**. Sample titles authentic (`Bas Kosters: Many loving arms`, `Q(Ei)R-Speurtocht!`) — verified against the agent's own tool_result content (the sub-URL responses contain matching Dutch event titles + descriptions). This is the "agent-shaped" win — not raw fetch capability, but the willingness to fall back to alternate URLs when the canonical one breaks.

### drapersjobs.com/jobs — Path B wins 20 to 0
Parsew returned 0 in 1.5s — likely got the same 3.7KB JS-shell or anti-bot response curl saw.

Path B made **1 tool call** (`web_fetch /jobs`) and got 20 jobs. **Verified against the tool_result content**: Anthropic's web_fetch returned the full rendered "2,571 Jobs" listings page including titles, companies, locations, posted dates. The 20 items in the agent's emitted JSON match the first 20 listings in the tool_result exactly (e.g. `Apparel Graphic Designer` — u&i Search Ltd, Leicester OR London, 17 Mar 2026). Not hallucinated.

I tried to spot-check one detail page (`/job/apparel-graphic-designer-14`) via a separate WebFetch and hit a bot wall ("Verification Required") — but the *listings* page itself was unblocked for Anthropic's web_fetch. Parsew couldn't crack the same URL. This is the strongest evidence for the "no residential proxies" framing of your question: CMA's web_fetch behaves like a more browser-shaped client on the listings page where Parsew's extract fails. Detail pages still get bot-challenged for both.

### metropool.nl/agenda — tie at 10 items
Both paths returned the same first five titles in the same order (`Monkeyjam`, `Frisse Blik & Esca$h`, `Oogst Live: Primaat + FOEK!`, `QRUSH`, `Bonkers Bingo`). The page is clean HTML, both extractors handle it equivalently. Path A is 3× faster and 2× cheaper for this case.

### fashionunited.uk/fashion-jobs — tie at 26 vs 25
Both returned plausible job listings, but **different ones**. Path A surfaced retail-floor jobs (Sports Direct/Nike-flavored): `Sales Assistant (M/F/D) Part-time - London`, `Assistant Store Manager - Battersea`. Path B surfaced corporate/HQ jobs: `Store Supervisor`, `Digital Commerce Data Analyst`, `Visual Merchandiser - Bicester Village`. Likely they each saw a different slice of the listings (the page paginates / the extractor decided on a viewport).

### fashionworkplace.com/jobs — tie at 20 each, identical titles
Despite being a Vercel/Next.js SPA with "enable JavaScript" in the bare HTML, **both paths got the same 20 jobs**. Parsew renders JS server-side; the agent presumably does similar. The SPA-rendering risk turned out not to be a discriminator here.

### fashionnetwork.com/jobs/ — both blocked
Path A: 0 in 3s. Path B: 0 in 16s after **3 tool calls** (the URL with-www, without-www, and `/jobs/list/`). The agent tried alternates and gave up. Cloudflare bot-wall beats both.

## Cost / time

```
Scenario               A_items A_$    A_s   B_items  B_$     B_s    B_tools
drapersjobs                  0  $0.025    1s     20  $0.081    42s   1
fashionnetwork-jobs          0  $0.025    3s      0  $0.017    16s   3
fashionunited-uk-jobs       26  $0.025   18s     25  $0.113    76s   1
fashionworkplace-jobs       20  $0.025    8s     20  $0.057    34s   1
metropool-agenda            10  $0.025   13s     10  $0.052    41s   1
visittwente-agenda           0  $0.025    6s     38  $0.243   129s   7
                                 $0.150              $0.564
```

**Cost ratio is 3.8× in favour of Parsew on the easy cases**, but Parsew's $0.025 buys zero events on visittwente and drapersjobs. CMA scales with effort (1 tool call → ~$0.05; 7 tool calls → ~$0.24). On the easy cases, the cost gap is real and matters for daily refresh.

## Answer to the question

> Verify if CMA is better at scraping vs Parsew (since parsew doesn't use any residential proxies atm).

**Sometimes yes, sometimes equivalent. CMA is the safety net, not the default.**

The "no residential proxies" framing turned out to be partly right but also incomplete:
- Cloudflare-grade challenges: **neither path bypasses** (fashionnetwork). If a site has a real WAF/JS-challenge in front, both lose.
- Mid-tier protection / SPA shells / weird routing: **CMA wins decisively** (visittwente, drapersjobs). Parsew's one-shot extract can't paginate sub-URLs or work around odd page shapes.
- Normal pages: **equivalent quality, Parsew 4× cheaper and 3× faster** (metropool, fashionworkplace).

The agent-shaped win on visittwente is the same shape as the discovery win: it's not raw bypass power, it's **the willingness to try multiple URLs and aggregate** when the first fetch isn't enough. Parsew's atomic `extract` can't do that.

## Suggested move

**Hybrid — Parsew first, CMA on empty.** Mirror the existing "extract as fallback for hard sites" pattern, just with CMA as the *second* fallback after Parsew extract returns zero.

```
refresh path for a source:
  1. Try CSS scraper (existing, cheapest)
  2. Try parsew.extract (existing fallback, $0.025)
  3. NEW: if (2) returns 0 items AND source has refreshed cleanly before, try CMA ($0.05–$0.25)
  4. If (3) returns 0, mark source 'broken'
```

Cost math: only sources where Parsew returns 0 incur the CMA cost. From this test, that's 2 of 6 (33%) but our sample is biased toward hard cases. In production, the rate would probably be <10%.

**Don't replace Parsew for the daily refresh.** That'd 4× scraping cost across the entire pipeline for no gain on the 80% of sources that work fine. The discovery rewrite is justified because discovery is one-shot + amortized; refresh is the opposite — runs daily, per source, for the lifetime of the subscription.

## Caveats

- 6 URLs, 1 run each. No replication.
- "Bot-walled" mapping based on a single curl probe + my own WebFetch probe. A real proxy budget might paint different pictures.
- I couldn't independently spot-check every CMA result because some detail pages bot-wall the WebFetch tool I used. Path B results look plausible (distinctive titles, real-looking URLs) but I'm trusting the agent's reported page contents.
- Pricing constants ($3/$15/$3.75/$0.30 per Mtok for sonnet-4-6) — adjust if Anthropic changes them; the verdict (Parsew cheaper on easy, CMA wins on Parsew-zeros) is robust to ~2× price changes.
- The "differ in surfaced jobs" finding for fashionunited could be reproducible (consistent slice each path picks) or noise (random sampling). One run can't tell.
