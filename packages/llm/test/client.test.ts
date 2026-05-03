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

  it('uses dotted Anthropic model IDs (not dashed)', () => {
    expect(MODELS.scoring).toMatch(/^anthropic\/claude-haiku-\d+\.\d+$/)
    expect(MODELS.scraperGen).toMatch(/^anthropic\/claude-sonnet-\d+\.\d+$/)
  })
})
