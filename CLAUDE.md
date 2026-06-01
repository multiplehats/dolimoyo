# Dolimoyo

Personalised digest service for anything with a listing feed — local events, SaaS product launches, job boards, etc. Users subscribe with a set of interests (and optionally a location) and receive scheduled email digests (daily / bidaily / weekly) containing LLM-curated picks with personalised blurbs.

## Architecture

Turborepo monorepo. One Cloudflare Worker (`apps/api`) backed by a Postgres database.

```
apps/api          Cloudflare Worker — HTTP API + Durable Objects
packages/
  db              Drizzle ORM schema + migrations (Postgres via Hyperdrive)
  llm             OpenRouter client wrapper
  parsew          Parsew web-search/scraping API client
  scrapers        CSS & extract scraper runners, plausibility checks
  email           React Email templates + AutoSend delivery client
  cli             `dolimoyo-subscribe` CLI for creating subscriptions
```

## Key flows

**Subscribe** → `POST /subscriptions` → creates DB row → bootstraps a `SubscriptionActor` Durable Object.

**SubscriptionActor** (Durable Object, alarm-driven):
1. `discover` phase — calls `pipeline/discover.ts`: Parsew web search → LLM ranks & filters event listing URLs → stores as `sources` rows → spawns a `SourceActor` per source.
2. `wait_for_sources` phase — polls until sources have scraped events (max 60 min).
3. `cadence` phase — runs `pipeline/digest.ts` on schedule, sends email via AutoSend.

**SourceActor** (Durable Object, alarm-driven):
1. `generate` phase — `pipeline/generate-scraper.ts`: LLM writes a CSS/extract scraper config for the source URL.
2. `refresh` phase — `pipeline/refresh.ts`: runs scraper, upserts `events` rows. Reschedules daily.
3. `regen` phase — re-generates scraper if refresh produced no plausible events.

**Digest** (`pipeline/digest.ts` + `pipeline/curate-digest.ts`):
- Fetches upcoming events for the subscription's location + cadence window.
- Pre-filters by keyword relevance to subscriber interests.
- LLM (`curate-digest.ts`) writes intro, picks top events, writes per-event blurbs, writes closer.
- Renders `DigestEmail` React Email template → sends via AutoSend.

## Tech stack

- **Runtime**: Cloudflare Workers + Durable Objects (SQLite storage per DO)
- **Database**: Postgres (local Docker on port 5434; prod via Cloudflare Hyperdrive)
- **ORM**: Drizzle (`packages/db`)
- **LLM**: OpenRouter (`packages/llm`) — nano model for discovery/scraper-gen, mini for curation
- **Web data**: Parsew API for search + HTML extraction (`packages/parsew`)
- **Email**: React Email templates + AutoSend transactional delivery (`packages/email`)
- **Framework**: Hono (HTTP routing)
- **Linting/formatting**: Biome
- **Tests**: Vitest (with `@cloudflare/vitest-pool-workers` for DO tests)
- **Secrets**: dotenvx encrypted `.env.local` / `.env.production`

## Dev setup

```bash
pnpm dev          # starts Postgres docker + all packages in dev mode
pnpm db:migrate   # run pending migrations
pnpm db:studio    # Drizzle Studio UI
pnpm test         # run all tests
pnpm lint         # Biome check
pnpm subscribe -- --location "Enschede" --lat 52.2215 --lng 6.8937 --interests "music,arts,food"
```

## Environment variables

See `apps/api/.env.example`. Secrets are managed with dotenvx:
```bash
cd apps/api && pnpm exec dotenvx set <KEY> <value>
```

Required: `OPENROUTER_API_KEY`, `PARSEW_API_KEY`, `AUTOSEND_API_KEY`.

## DB schema overview

`subscriptions` → `sources` → `scrapers` + `events` → `digest_runs`  
`api_calls` tracks cost per provider (parsew / openrouter / autosend).

See `packages/db/src/schema.ts` for full schema.
