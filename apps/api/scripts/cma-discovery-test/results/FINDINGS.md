# CMA vs current discovery pipeline — findings

Test setup: 3 scenarios × 2 paths.
Path A = current `discoverSources` (Parsew search/map + gpt-5-nano scoring).
Path B = Claude Managed Agent (claude-sonnet-4-6 + `agent_toolset_20260401`, cloud sandbox, 5-min timeout per session).

## Headline

| Scenario | A count | B count | Overlap | Verdict |
|---|---:|---:|---:|---|
| Enschede events (NL) | 10 | 7 | 3 | Different shapes — A finds aggregators, B finds venue anchors |
| Lisbon events (PT) | 6 | 7 | 2 | B clearly better — A has stale SEO, B finds the city's own cultural operator |
| Fashion Workplace (jobs) | 7 | 9 | **0** | B wins by default — A is structurally event-tuned |

| | Path A | Path B |
|---|---:|---:|
| Total cost | $1.54 | $3.53 |
| Total wall time | 33 min | 14 min |
| Per-candidate verification | none (LLM scores URLs from titles only) | each candidate `web_fetch`-ed |

## Per-scenario details

### Enschede events (NL)

**Overlap (3):** visittwente.nl, wilminktheater.nl, concordia.nl — both paths agree on the strongest signals.

**Only Path A — 7:** uitinenschede.nl, uitzinnig.nl, deenschedegids.nl, visit-enschede.com, podiuminfo.nl, phion.nl, visitenschede.nl
- *Spot-check: uitinenschede.nl/agenda (Path A's TOP-SCORED at 9.0) is actually a navigation hub with NO visible events on the page itself.* The current pipeline's nano scorer ranks URLs by title/path keywords without verifying the page renders events.
- *Spot-check: visit-enschede.com/events/ is a "navigation hub with zero upcoming events displayed."*
- *Spot-check: visitenschede.nl certificate expired — dead/unmaintained.*
- All others look fine but lean aggregator/tourism-board.

**Only Path B — 4:** muziekladder.nl, metropool.nl, rijksmuseumtwenthe.nl, jazzpodiumdetor.nl
- These are core Enschede cultural institutions — the actual pop venue (Metropool), the major fine-arts museum (Rijksmuseum Twenthe), the dedicated jazz venue (Jazzpodium De Tor), plus a comprehensive regional concert aggregator (Muziekladder). All four returned with concrete event-title + date evidence the agent had verified.

**Read:** they're finding *different shapes*. Path A's STEMS (`uitagenda`, `evenementen`) bias toward sites whose URL/title contains those literal keywords — that's aggregators. Path B doesn't search for keywords; it searches for "what to do in Enschede" and reasons about which sites are actually the cultural anchors. For a digest's purposes, the venue anchors are arguably higher quality (Metropool publishes earlier than aggregators repost), but aggregators give breadth. Complementary, not strictly better.

### Lisbon events (PT)

**Overlap (2):** visitlisboa.com, aml.pt — official tourism + municipal area.

**Only Path A — 4:** arena.meo.pt, ccb.pt, lisboa-live.com, lisboacomvida.scml.pt
- Two solid (arena.meo, ccb), one stale SEO (lisboa-live.com — verified: "evergreen content designed for SEO… no current dates"), one institutional but narrow (lisboacomvida = Misericordia social).

**Only Path B — 5:** egeac.pt, timeout.pt, 360.cascais.pt, cardapio.pt, atlaslisboa.com
- **egeac.pt** is high-value — Lisbon's *own municipal cultural operator* runs Teatro São Luiz, Museu do Fado, Castelo de São Jorge, Casa Fernando Pessoa. Verified live with 147+ events. Path A missed it entirely.
- **timeout.pt** weekly curated music picks. **atlaslisboa.com** dedicated monthly What's-On in English (current page is "June 2026", verified). **360.cascais.pt** = Cascais municipal agenda. **cardapio.pt** food-culture crossover.

**Read:** Path B clearly outperforms here. The agent searches in Portuguese, finds the actual cultural-operator domain Path A's STEMS don't surface, and verifies pages have current content before listing. Path A's "lisboa-live.com" entry is a textbook nano-scoring failure — the URL *looks* like a listings page; the page itself is stale evergreen filler.

### Fashion Workplace (EU fashion jobs)

**Overlap: 0.** Confirms the structural read.

**Only Path A — 7:** europeanbestdestinations.com/top/best-events-in-europe/, culture.ec.europa.eu/whats-new/events, forbes.com article, euronews.com agenda article, liveurope.eu/concerts (verified: concerts, not jobs), guides.ticketmaster.co.uk, dezeen.com/eventsguide/
- All seven are about events. The pipeline searched `events Europe`, `evenementen agenda Europe`, `fashion jobs Europe agenda`, etc. The "events" stems dominate and the nano scorer ranks event pages high regardless of whether they're job listings. Predicted failure mode, confirmed.

**Only Path B — 9:** fashionunited.uk/.fr/.it/.de/.nl/.be (six country editions of the leading pan-European fashion job network), fashionworkplace.com/jobs (Fashion Workplace itself — discoverable, good), fashionworkie.com (UK studio roles), drapersjobs.com (Drapers trade press)
- All nine are fashion job boards. Verified live with named brands (Dr. Martens, Prada, Sessùn, Mulberry, Dries Van Noten).

**Read:** The current pipeline is structurally unable to serve this vertical without a full rewrite of the STEMS layer and candidate-shape detection. The managed agent handles it natively because its only "STEMS" is the user's English/local-language prompt.

## Cost / time

```
Path A (no per-candidate verification)
  Enschede        $0.4002   382s
  Lisbon          $0.4901   699s
  Fashion         $0.6503   909s
  ─────────────   ───────  ─────
  Total           $1.5406  1990s   (33 min)

Path B (model+search; web_fetch billed in token cost)
  Enschede        $1.2182   238s   ( 7 search, 17 fetch)
  Lisbon          $1.0526   236s   ( 4 search, 21 fetch)
  Fashion         $1.2578   344s   ( 6 search, 30 fetch)  [hit 5-min timeout]
  ─────────────   ───────  ─────
  Total           $3.5286   818s   (14 min)
```

**The cost comparison isn't apples-to-apples.** Path A's $1.54 buys an *unverified* output — nano ranks URLs by title alone, never reading the page. Path B's $3.53 buys a *verified* output — every candidate is `web_fetch`-ed before being listed. If Path A added verification (a Parsew `extract` or LLM pass per candidate to confirm the page actually shows events), its cost would rise materially. The honest read: Path B is more expensive *and* includes verification; Path A is cheaper *and* doesn't.

Path B is also ~2.4× faster wall-clock (more concurrent tool calls per session vs Path A's serial Parsew queries).

`$0.01/web_search` is an estimate; if Anthropic's actual web-search price differs by 2× the verdict still holds since search is a small fraction of total Path B cost.

Fashion Workplace hit the 5-minute session timeout. 9 candidates is still a solid result, but it's worth noting the budget could matter on harder scenarios.

## Recommendation

**Worth owning explicitly:** my earlier take dismissed discovery as "single-shot scoring, no agent-shaped loop to compare against." This test contradicts that specific point. The agent-shaped part of discovery isn't *exploration breadth* — it's *verification before recommending*. `uitinenschede.nl/agenda` scored 9.0 by Path A and is a navigation hub with zero events on the page; `lisboa-live.com` scored 5.0 and is stale SEO content. That's a miscalibration the nano scorer cannot fix, because it never reads the page body. The bulk-of-pipeline critique from the original take still holds — scraper-gen, refresh, curation, date-rescue are not agent-shaped — but discovery is where the data flipped the call.

Direct answer to the question you posed: **Yes, for finding latest/interesting sources, CMA is better. Three reasons, in order of weight:**

1. **It verifies before recommending.** Path A's top-ranked Enschede source (uitinenschede.nl, score 9.0) is a navigation hub with no visible events; Path A's #5 Lisbon source is stale SEO. Path A has no way to detect this because the nano scorer never reads the page body. Path B `web_fetch`-es every candidate before listing it.

2. **It generalizes across verticals.** Fashion Workplace exposes the current pipeline's hard-coded event vocabulary. The agent doesn't need that vocabulary — it derives queries from the task. If you want to add a second vertical (jobs, SaaS launches, etc.), CMA is the cheaper path than maintaining N parallel STEMS tables.

3. **It searches in the native language unprompted.** For Lisbon (pt), it found egeac.pt — the city's own cultural operator — via Portuguese queries the current STEMS would never produce. Adding Finnish/Estonian/Greek STEMS to your pipeline by hand is busywork the agent absorbs for free.

**But: don't just rip out the current pipeline.** Three caveats:

a. **Cost shape.** This was 3 discovery runs. If you bootstrap one user per location and *cache* sources for reuse (which `discoverSources` does by reading existing sources for `locationKey`), the discovery is amortized over many digests. At ~$1.20/run vs $0.50/run, both are negligible per-subscription. The cost question is "per discovery", not "per digest" — and discovery is one-shot.

b. **Path A and Path B find different shapes.** Aggregators (Path A's strength) give breadth; venue pages (Path B's strength) give depth. The right system probably runs both and merges. Cheap to do — Path A is already there.

c. **Managed Agents is beta + Anthropic-only.** Adding it as a hard dependency in the bootstrap loop is fine for this use case (discovery is rare, latency-tolerant, idempotent), but be aware: it commits you to Anthropic for the highest-margin LLM call in your stack and adds a vendor.

**Concrete suggested move:**
- **Replace `discoverSources` with a CMA-based discovery for all verticals.** For non-events (Fashion Workplace), Path A can't serve at all. For events, Path B's lists already cover the breadth + depth combo on their own — look at the Enschede list: visittwente + muziekladder (aggregators) + wilminktheater + concordia + metropool + rijksmuseum + jazzpodium (venue anchors). After excluding the dead URLs Path A produced, its remaining unique contribution is modest (podiuminfo, phion). Running both adds operational complexity for marginal extra coverage.
- A "keep both and merge" hybrid is defensible — judgment call, not data-driven from this test. If you want to retain Path A for cost-floor or vendor-diversification reasons, merging is straightforward.
- Don't touch the rest of the pipeline. Scraper-gen, refresh, dateRescue, curation are unchanged from the earlier analysis — those aren't agent-shaped.

## Caveats / limitations of this test

- One run per scenario per path. Both pipelines have randomness; replication N=3 would reduce noise.
- Path A's nano scoring isn't deterministic either (temperature). Different runs would re-rank the bottom of the list.
- Spot-check verification used `WebFetch` — sampled ~5 URLs, not all 32 unique URLs. The clearest signal (uitinenschede #1 being a nav hub; lisboa-live being SEO; Path A returning event sites for a jobs query) doesn't depend on full enumeration.
- Path B's `claude-sonnet-4-6` is more expensive than nano; a managed agent on a cheaper model (Haiku) might cut costs but probably hurts the "verify before recommend" loop. Not tested.
- The Fashion Workplace scenario is somewhat unfair to Path A by construction. That's the point — it exposes a real product limitation, not a bug.
