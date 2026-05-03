import { DurableObject } from 'cloudflare:workers'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { schema, type Database } from '@uitagenda/db'
import type { Env } from '../env'
import { createDbForEnv } from '../services/db'
import { createLedger } from '../services/ledger'
import { createParsewForEnv } from '../services/parsew'
import { createLLMForEnv } from '../services/llm'
import { createEmailForEnv } from '../services/email'
import { discoverSources } from '../pipeline/discover'
import { sendDigestForSubscription, type UpcomingEvent } from '../pipeline/digest'

type Phase = 'discover' | 'wait_for_sources' | 'cadence'
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const POLL_MS = 60_000
const MAX_WAIT_POLLS = 60 // 60 minutes — accommodates slow LLM days + multi-source generation chains

export class SubscriptionActor extends DurableObject<Env> {
  /**
   * Bootstrap RPC. Returns IMMEDIATELY after persisting state + scheduling
   * the first alarm 1s out. All heavy work runs in alarm() context.
   */
  async bootstrap(subscriptionId: string): Promise<void> {
    const existing = await this.ctx.storage.get<string>('subscriptionId')
    if (existing && existing !== subscriptionId) {
      throw new Error(`SubscriptionActor already bound to ${existing}, refusing rebind`)
    }
    if (!existing) {
      await this.ctx.storage.put('subscriptionId', subscriptionId)
      await this.ctx.storage.put<Phase>('phase', 'discover')
      await this.ctx.storage.put<number>('waitPolls', 0)
    }
    const current = await this.ctx.storage.getAlarm()
    if (current === null) await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  override async alarm(): Promise<void> {
    const subscriptionId = await this.ctx.storage.get<string>('subscriptionId')
    if (!subscriptionId) return

    const phase = (await this.ctx.storage.get<Phase>('phase')) ?? 'discover'
    try {
      switch (phase) {
        case 'discover':
          await this.runDiscovery(subscriptionId)
          await this.ctx.storage.put<Phase>('phase', 'wait_for_sources')
          await this.ctx.storage.put<number>('waitPolls', 0)
          await this.ctx.storage.setAlarm(Date.now() + POLL_MS)
          return
        case 'wait_for_sources': {
          const ready = await this.sourcesReady(subscriptionId)
          const polls = ((await this.ctx.storage.get<number>('waitPolls')) ?? 0) + 1
          if (ready || polls >= MAX_WAIT_POLLS) {
            await this.runDigest(subscriptionId)
            await this.ctx.storage.put<Phase>('phase', 'cadence')
            await this.scheduleNextDigest(subscriptionId)
          } else {
            await this.ctx.storage.put<number>('waitPolls', polls)
            await this.ctx.storage.setAlarm(Date.now() + POLL_MS)
          }
          return
        }
        case 'cadence':
          await this.runDigest(subscriptionId)
          await this.scheduleNextDigest(subscriptionId)
          return
      }
    } catch (err) {
      console.error(`SubscriptionActor alarm failed for ${subscriptionId} (phase=${phase})`, err)
      // Reviewer fix: re-check expiry before scheduling a retry, otherwise an
      // expired-trip sub that throws once would re-arm forever.
      const sub = await loadSubscription(createDbForEnv(this.env), subscriptionId)
      if (sub && sub.endsAt && sub.endsAt < new Date()) {
        await markExpired(createDbForEnv(this.env), subscriptionId)
        return
      }
      await this.ctx.storage.setAlarm(Date.now() + 60 * 60_000)
    }
  }

  private async runDiscovery(subscriptionId: string): Promise<void> {
    const db = createDbForEnv(this.env)
    const ledger = createLedger(db)
    const parsew = createParsewForEnv(this.env, ledger, { subscriptionId })
    const llm = createLLMForEnv(this.env, ledger, { subscriptionId })

    const sub = await loadSubscription(db, subscriptionId)
    if (!sub) throw new Error(`subscription ${subscriptionId} not found`)

    const existing = await db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.locationKey, sub.locationKey), eq(schema.sources.status, 'active')))

    let sourceIds: string[]
    if (existing.length > 0) {
      sourceIds = existing.map((s) => s.id)
    } else {
      const discovered = await discoverSources({
        location: {
          label: sub.locationLabel,
          lat: sub.locationLat,
          lng: sub.locationLng,
          radiusKm: sub.locationRadiusKm,
        },
        interests: sub.interests,
        language: 'nl',
        parsew,
        llm,
        topN: 5,
      })
      sourceIds = []
      for (const d of discovered) {
        const inserted = await db
          .insert(schema.sources)
          .values({
            domain: d.domain,
            listingUrl: d.listingUrl,
            locationLabel: sub.locationLabel,
            locationKey: sub.locationKey,
            locationLat: sub.locationLat,
            locationLng: sub.locationLng,
            locationRadiusKm: sub.locationRadiusKm,
            language: 'nl',
            discoveryScore: d.score,
          })
          .onConflictDoNothing({ target: schema.sources.listingUrl })
          .returning({ id: schema.sources.id })
        if (inserted[0]) {
          sourceIds.push(inserted[0].id)
        } else {
          // listingUrl conflict — another sub already discovered this URL.
          // Recover the existing id so we still bootstrap its actor (idempotent).
          const [existingRow] = await db
            .select({ id: schema.sources.id })
            .from(schema.sources)
            .where(eq(schema.sources.listingUrl, d.listingUrl))
            .limit(1)
          if (existingRow) sourceIds.push(existingRow.id)
        }
      }
    }

    await this.ctx.storage.put<string[]>('sourceIds', sourceIds)

    // Trigger each SourceActor's bootstrap in parallel. Each RPC returns in
    // milliseconds (SourceActor.bootstrap sets a 1s alarm and returns); the
    // heavy work runs in alarm context, not here.
    await Promise.all(
      sourceIds.map((id) =>
        this.env.SOURCE_ACTOR.get(this.env.SOURCE_ACTOR.idFromName(id)).bootstrap(id),
      ),
    )
  }

  private async sourcesReady(subscriptionId: string): Promise<boolean> {
    const db = createDbForEnv(this.env)
    const sub = await loadSubscription(db, subscriptionId)
    if (!sub) return false
    // Ready means: at least one source for this location has at least one event.
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.events)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.events.sourceId))
      .where(eq(schema.sources.locationKey, sub.locationKey))
    return (row?.n ?? 0) > 0
  }

  private async runDigest(subscriptionId: string): Promise<void> {
    const db = createDbForEnv(this.env)
    const email = createEmailForEnv(this.env)

    const sub = await loadSubscription(db, subscriptionId)
    if (!sub) return

    if (sub.endsAt && sub.endsAt < new Date()) {
      await markExpired(db, sub.id)
      return
    }

    await sendDigestForSubscription({
      subscription: {
        id: sub.id,
        userEmail: sub.userEmail,
        locationLabel: sub.locationLabel,
        cadence: sub.cadence,
        lastDigestAt: sub.lastDigestAt,
      },
      now: new Date(),
      queryEvents: (range) => queryUpcoming(db, sub.locationKey, range),
      sendEmail: email.send,
      recordRun: async (run) => {
        await db
          .insert(schema.digestRuns)
          .values({
            subscriptionId: run.subscriptionId,
            windowStart: run.windowStart,
            windowEnd: run.windowEnd,
            eventIds: run.eventIds,
            autosendId: run.autosendId ?? undefined,
            deliveryStatus: run.deliveryStatus,
            sentAt: run.deliveryStatus === 'sent' ? new Date() : null,
          })
          .onConflictDoNothing({
            target: [schema.digestRuns.subscriptionId, schema.digestRuns.windowStart],
          })
      },
    })

    await db.update(schema.subscriptions).set({ lastDigestAt: new Date() }).where(eq(schema.subscriptions.id, sub.id))
  }

  private async scheduleNextDigest(subscriptionId: string): Promise<void> {
    const db = createDbForEnv(this.env)
    const sub = await loadSubscription(db, subscriptionId)
    if (!sub) return
    if (sub.endsAt && sub.endsAt < new Date()) {
      await markExpired(db, sub.id)
      return
    }
    const next = Date.now() + (sub.cadence === 'daily' ? DAY_MS : WEEK_MS)
    await this.ctx.storage.setAlarm(next)
  }
}

async function loadSubscription(db: Database, subscriptionId: string) {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    .limit(1)
  return row ?? null
}

async function markExpired(db: Database, subscriptionId: string) {
  await db
    .update(schema.subscriptions)
    .set({ status: 'expired' })
    .where(eq(schema.subscriptions.id, subscriptionId))
}

async function queryUpcoming(
  db: Database,
  locationKey: string,
  range: { from: Date; to: Date },
): Promise<UpcomingEvent[]> {
  const rows = await db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      url: schema.events.url,
      startsAt: schema.events.startsAt,
      venueName: schema.events.venueName,
      description: schema.events.description,
    })
    .from(schema.events)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.events.sourceId))
    .where(
      and(
        eq(schema.sources.locationKey, locationKey),
        gte(schema.events.startsAt, range.from),
        lte(schema.events.startsAt, range.to),
      ),
    )
    .orderBy(schema.events.startsAt)
    .limit(50)

  return rows.map((r) => ({
    eventId: r.eventId,
    title: r.title,
    url: r.url,
    startsAt: r.startsAt,
    venueName: r.venueName,
    description: r.description,
  }))
}
