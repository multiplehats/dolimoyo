import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const subscriptionKind = pgEnum('subscription_kind', ['home', 'trip'])
export const subscriptionStatus = pgEnum('subscription_status', ['active', 'paused', 'expired'])
// `bidaily` = one digest every other day (≈ 3.5/week). The middle ground when
// daily feels noisy and weekly feels stale.
export const cadence = pgEnum('cadence', ['daily', 'bidaily', 'weekly'])
export const sourceStatus = pgEnum('source_status', ['active', 'broken', 'dead'])
export const scraperKind = pgEnum('scraper_kind', ['css', 'extract'])
export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sent', 'failed'])
export const apiProvider = pgEnum('api_provider', ['parsew', 'openrouter', 'autosend'])

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    kind: subscriptionKind('kind').notNull(),
    locationLabel: text('location_label').notNull(),
    locationKey: text('location_key').notNull(),
    locationLat: real('location_lat').notNull(),
    locationLng: real('location_lng').notNull(),
    locationRadiusKm: real('location_radius_km').notNull().default(25),
    interests: text('interests').array().notNull().default([]),
    cadence: cadence('cadence').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: subscriptionStatus('status').notNull().default('active'),
    lastDigestAt: timestamp('last_digest_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_location_key_idx').on(t.locationKey),
    check(
      'subscriptions_cadence_by_kind',
      sql`(${t.kind} = 'home') OR (${t.kind} = 'trip' AND ${t.cadence} = 'daily')`,
    ),
  ],
)

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domain: text('domain').notNull(),
    listingUrl: text('listing_url').notNull(),
    locationLabel: text('location_label').notNull(),
    locationKey: text('location_key').notNull(),
    locationLat: real('location_lat').notNull(),
    locationLng: real('location_lng').notNull(),
    locationRadiusKm: real('location_radius_km').notNull().default(25),
    language: text('language').notNull().default('nl'),
    status: sourceStatus('status').notNull().default('active'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    discoveryScore: real('discovery_score'),
  },
  (t) => [
    uniqueIndex('sources_listing_url_idx').on(t.listingUrl),
    index('sources_location_key_status_idx').on(t.locationKey, t.status),
  ],
)

export const scrapers = pgTable(
  'scrapers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    kind: scraperKind('kind').notNull(),
    config: jsonb('config').notNull(),
    version: integer('version').notNull(),
    active: boolean('active').notNull().default(true),
    generatedByModel: text('generated_by_model'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: text('last_run_status'),
  },
  (t) => [
    uniqueIndex('scrapers_source_version_idx').on(t.sourceId, t.version),
    uniqueIndex('scrapers_source_active_idx')
      .on(t.sourceId)
      .where(sql`${t.active} = true`),
  ],
)

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    venueName: text('venue_name'),
    venueAddress: text('venue_address'),
    venueLat: real('venue_lat'),
    venueLng: real('venue_lng'),
    priceText: text('price_text'),
    url: text('url').notNull(),
    imageUrl: text('image_url'),
    tags: text('tags').array().notNull().default([]),
    language: text('language').notNull().default('nl'),
    raw: jsonb('raw'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentHash: text('content_hash').notNull(),
  },
  (t) => [
    uniqueIndex('events_source_content_hash_idx').on(t.sourceId, t.contentHash),
    index('events_starts_at_idx').on(t.startsAt),
  ],
)

export const digestRuns = pgTable(
  'digest_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    eventIds: uuid('event_ids').array().notNull().default([]),
    deliveryStatus: deliveryStatus('delivery_status').notNull().default('queued'),
    autosendId: text('autosend_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('digest_runs_sub_window_idx').on(t.subscriptionId, t.windowStart),
  ],
)

export const apiCalls = pgTable(
  'api_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: apiProvider('provider').notNull(),
    endpoint: text('endpoint').notNull(),
    costUnits: numeric('cost_units', { precision: 14, scale: 8 }).notNull().default('0'),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('api_calls_occurred_at_idx').on(t.occurredAt),
    index('api_calls_provider_idx').on(t.provider, t.occurredAt),
  ],
)
