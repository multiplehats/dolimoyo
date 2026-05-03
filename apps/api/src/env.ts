import type { DurableObjectNamespace, Hyperdrive } from '@cloudflare/workers-types'
import type { SubscriptionActor } from './actors/subscription-actor'
import type { SourceActor } from './actors/source-actor'

export interface Env {
  HYPERDRIVE: Hyperdrive
  SUBSCRIPTION_ACTOR: DurableObjectNamespace<SubscriptionActor>
  SOURCE_ACTOR: DurableObjectNamespace<SourceActor>
  PARSEW_API_KEY: string
  OPENROUTER_API_KEY: string
  AUTOSEND_API_KEY: string
  ADMIN_SECRET: string
  FROM_EMAIL: string
  FROM_NAME?: string
}
