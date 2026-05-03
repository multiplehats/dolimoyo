import { createParsewClient, type ParsewClient } from '@uitagenda/parsew'
import type { Env } from '../env'
import type { createLedger } from './ledger'

export function createParsewForEnv(
  env: Env,
  ledger: ReturnType<typeof createLedger>,
  attribution: { sourceId?: string | null; subscriptionId?: string | null } = {},
): ParsewClient {
  return createParsewClient({
    apiKey: env.PARSEW_API_KEY,
    onCall: (e) => {
      ledger.record({
        provider: 'parsew',
        endpoint: e.endpoint,
        costUnits: e.costUnits,
        sourceId: attribution.sourceId ?? null,
        subscriptionId: attribution.subscriptionId ?? null,
      })
    },
  })
}
