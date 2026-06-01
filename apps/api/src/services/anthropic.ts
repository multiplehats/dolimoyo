import Anthropic from '@anthropic-ai/sdk'
import type { Env } from '../env'
import type { createLedger } from './ledger'

// Pricing per million tokens for claude-sonnet-4-6 (input / output / cache).
// Source: https://www.anthropic.com/pricing. Keep these in sync if Anthropic
// changes them — recorded costs depend on these constants alone.
const PRICE_PER_MTOK = {
  input: 3.0,
  output: 15.0,
  cacheWrite: 3.75,
  cacheRead: 0.3,
} as const

export interface ModelUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function usageCostUSD(u: ModelUsage): number {
  const input = (u.input_tokens ?? 0) * (PRICE_PER_MTOK.input / 1_000_000)
  const output = (u.output_tokens ?? 0) * (PRICE_PER_MTOK.output / 1_000_000)
  const cacheWrite =
    (u.cache_creation_input_tokens ?? 0) * (PRICE_PER_MTOK.cacheWrite / 1_000_000)
  const cacheRead =
    (u.cache_read_input_tokens ?? 0) * (PRICE_PER_MTOK.cacheRead / 1_000_000)
  return input + output + cacheWrite + cacheRead
}

export interface AnthropicHandles {
  client: Anthropic
  recordUsage: (endpoint: string, usage: ModelUsage) => Promise<void>
}

export function createAnthropicForEnv(
  env: Env,
  ledger: ReturnType<typeof createLedger>,
  attribution: { sourceId?: string | null; subscriptionId?: string | null } = {},
): AnthropicHandles {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return {
    client,
    recordUsage: async (endpoint, usage) => {
      await ledger.record({
        provider: 'anthropic',
        endpoint,
        costUnits: usageCostUSD(usage),
        sourceId: attribution.sourceId ?? null,
        subscriptionId: attribution.subscriptionId ?? null,
        metadata: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        },
      })
    },
  }
}
