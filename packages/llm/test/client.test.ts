import { describe, expect, it } from 'vitest'
import { createLLMClient, MODELS } from '../src'

describe('llm package', () => {
  it('throws if api key is missing', () => {
    expect(() => createLLMClient({ apiKey: '' })).toThrow(/api key/i)
  })

  it('exports generateObject + generateText methods', () => {
    const client = createLLMClient({ apiKey: 'or_test' })
    expect(typeof client.generateObject).toBe('function')
    expect(typeof client.generateText).toBe('function')
  })

  it('uses dotted Anthropic model IDs for scraper tasks', () => {
    expect(MODELS.scraperGen).toMatch(/^anthropic\/claude-sonnet-\d+\.\d+$/)
    expect(MODELS.scraperRegen).toMatch(/^anthropic\/claude-sonnet-\d+\.\d+$/)
  })

  it('uses cheap models for high-volume structured-output tasks', () => {
    expect(MODELS.scoring).toBe('openai/gpt-5-nano')
    expect(MODELS.tagging).toBe('openai/gpt-5-nano')
    expect(MODELS.dateRescue).toBe('openai/gpt-5-nano')
  })
})
