import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { schema, locationKey } from '@uitagenda/db'
import { createDbForEnv } from '../services/db'
import type { Env } from '../env'

const createSubSchema = z.object({
  userEmail: z.string().email(),
  kind: z.enum(['home', 'trip']).default('home'),
  locationLabel: z.string().min(1),
  locationLat: z.number(),
  locationLng: z.number(),
  locationRadiusKm: z.number().positive().default(25),
  interests: z.array(z.string()).min(1),
  cadence: z.enum(['daily', 'bidaily', 'weekly']).optional(),
  endsAt: z.string().datetime().optional(),
})

export const subscriptionsRoute = new Hono<{ Bindings: Env }>()

// Phase 0: ALL subscription routes (POST + GET) require admin auth — there is no
// end-user dashboard yet. Phase 3 will introduce Better Auth and split GET /:id
// into a user-scoped route gated on session, while keeping POST / admin-only.
subscriptionsRoute.use('*', async (c, next) => {
  const provided = c.req.header('x-admin-secret')
  if (!provided || provided !== c.env.ADMIN_SECRET) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

subscriptionsRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = createSubSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

  // Cadence derived from kind unless explicitly provided.
  const cadence = parsed.data.cadence ?? (parsed.data.kind === 'trip' ? 'daily' : 'weekly')
  if (parsed.data.kind === 'trip' && cadence !== 'daily') {
    return c.json({ error: 'trip subscriptions must be daily cadence' }, 400)
  }

  const db = createDbForEnv(c.env)
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      userEmail: parsed.data.userEmail,
      kind: parsed.data.kind,
      locationLabel: parsed.data.locationLabel,
      locationKey: locationKey(parsed.data.locationLabel),
      locationLat: parsed.data.locationLat,
      locationLng: parsed.data.locationLng,
      locationRadiusKm: parsed.data.locationRadiusKm,
      interests: parsed.data.interests,
      cadence,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
    })
    .returning({ id: schema.subscriptions.id })

  if (!row) return c.json({ error: 'failed to insert' }, 500)

  // Fire-and-forget. The SubscriptionActor's bootstrap returns immediately
  // after scheduling its first alarm 1s out. All heavy work runs in alarm context.
  // We still await here because bootstrap itself is fast (just a storage write +
  // alarm registration). If it ever becomes slow, switch to executionCtx.waitUntil.
  const stub = c.env.SUBSCRIPTION_ACTOR.get(c.env.SUBSCRIPTION_ACTOR.idFromName(row.id))
  await stub.bootstrap(row.id)

  return c.json({ id: row.id }, 202)
})

subscriptionsRoute.get('/:id', async (c) => {
  const db = createDbForEnv(c.env)
  const id = c.req.param('id')
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id)).limit(1)
  if (!sub) return c.notFound()
  return c.json(sub)
})
