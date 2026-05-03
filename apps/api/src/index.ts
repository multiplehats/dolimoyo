import { Hono } from 'hono'
import type { Env } from './env'
import { subscriptionsRoute } from './routes/subscriptions'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => c.text('uitagenda api ok'))
app.get('/healthz', (c) => c.json({ ok: true }))

app.route('/subscriptions', subscriptionsRoute)

export default { fetch: app.fetch } satisfies ExportedHandler<Env>

export { SubscriptionActor } from './actors/subscription-actor'
export { SourceActor } from './actors/source-actor'
