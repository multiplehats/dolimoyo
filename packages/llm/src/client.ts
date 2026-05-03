import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateObject, generateText } from 'ai'
import type { z } from 'zod'
import { MAX_OUTPUT_TOKENS, MODELS, type Task } from './models'

export interface LLMLedgerEvent {
  task: Task
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUSD: number
}

export interface LLMClientOptions {
  apiKey: string
  appName?: string
  appUrl?: string
  onCall?: (e: LLMLedgerEvent) => void
}

export interface LLMClient {
  generateObject<T>(args: {
    task: Task
    schema: z.ZodSchema<T>
    prompt: string
    system?: string
    maxOutputTokens?: number
  }): Promise<T>
  generateText(args: {
    task: Task
    prompt: string
    system?: string
    maxOutputTokens?: number
  }): Promise<string>
}

interface OpenRouterUsageMeta {
  cost?: number
  totalTokens?: number
}

export function createLLMClient(options: LLMClientOptions): LLMClient {
  if (!options.apiKey?.trim()) throw new Error('OpenRouter api key is required')
  const openrouter = createOpenRouter({
    apiKey: options.apiKey,
    appName: options.appName,
    appUrl: options.appUrl,
  })

  const model = (task: Task) =>
    openrouter(MODELS[task], { usage: { include: true } })

  const recordUsage = (
    task: Task,
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
    providerMetadata: { openrouter?: { usage?: OpenRouterUsageMeta } } | undefined,
  ) => {
    const inputTokens = usage?.inputTokens ?? 0
    const outputTokens = usage?.outputTokens ?? 0
    const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens
    const costUSD = providerMetadata?.openrouter?.usage?.cost ?? 0
    options.onCall?.({
      task,
      model: MODELS[task],
      inputTokens,
      outputTokens,
      totalTokens,
      costUSD,
    })
  }

  return {
    async generateObject({ task, schema, prompt, system, maxOutputTokens }) {
      const result = await generateObject({
        model: model(task),
        schema,
        prompt,
        system,
        maxOutputTokens: maxOutputTokens ?? MAX_OUTPUT_TOKENS[task],
      })
      recordUsage(task, result.usage, result.providerMetadata as never)
      return result.object as never
    },
    async generateText({ task, prompt, system, maxOutputTokens }) {
      const result = await generateText({
        model: model(task),
        prompt,
        system,
        maxOutputTokens: maxOutputTokens ?? MAX_OUTPUT_TOKENS[task],
      })
      recordUsage(task, result.usage, result.providerMetadata as never)
      return result.text
    },
  }
}
