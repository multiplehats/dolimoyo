import { createLLMClient, type LLMClient } from '@uitagenda/llm'
import type { Env } from '../env'
import type { createLedger } from './ledger'

export function createLLMForEnv(
  env: Env,
  ledger: ReturnType<typeof createLedger>,
  attribution: { sourceId?: string | null; subscriptionId?: string | null } = {},
): LLMClient {
  return createLLMClient({
    apiKey: env.OPENROUTER_API_KEY,
    appName: 'uitagenda',
    onCall: (e) => {
      ledger.record({
        provider: 'openrouter',
        endpoint: `${e.task}:${e.model}`,
        costUnits: e.costUSD,
        sourceId: attribution.sourceId ?? null,
        subscriptionId: attribution.subscriptionId ?? null,
        metadata: {
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          totalTokens: e.totalTokens,
        },
      })
    },
  })
}
