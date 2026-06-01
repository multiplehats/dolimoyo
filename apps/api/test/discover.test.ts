import { describe, expect, it, vi } from 'vitest'
import { discoverSources, type DiscoverArgs } from '../src/pipeline/discover'

// Build a fake AnthropicHandles whose stream replays the canned events given.
function fakeAnthropic(stream: Array<Record<string, unknown>>) {
  const recordUsage = vi.fn(async () => {})
  const client = {
    beta: {
      agents: { create: vi.fn(async () => ({ id: 'agent_test', version: 1 })) },
      environments: { create: vi.fn(async () => ({ id: 'env_test' })) },
      sessions: {
        create: vi.fn(async () => ({ id: 'sess_test' })),
        events: {
          stream: vi.fn(async () => ({
            [Symbol.asyncIterator]: async function* () {
              for (const ev of stream) yield ev
            },
          })),
          send: vi.fn(async () => {}),
        },
      },
    },
  }
  return { client: client as never, recordUsage }
}

const baseArgs: Omit<DiscoverArgs, 'anthropic'> = {
  location: { label: 'Enschede', lat: 52.22, lng: 6.89, radiusKm: 25 },
  interests: ['music', 'arts'],
  topN: 5,
}

describe('discoverSources', () => {
  it('parses fenced JSON, scores+sorts, returns top N', async () => {
    const finalText = `Here are the verified sources:

\`\`\`json
{
  "candidates": [
    { "url": "https://visittwente.nl/agenda", "domain": "visittwente.nl", "title": "Visit Twente", "language": "nl", "score": 8 },
    { "url": "https://metropool.nl/agenda", "domain": "metropool.nl", "title": "Metropool", "language": "nl", "score": 9 },
    { "url": "https://example.com/x", "domain": "example.com", "title": "Low", "language": "nl", "score": 4 }
  ]
}
\`\`\`
`
    const anthropic = fakeAnthropic([
      { type: 'agent.message', content: [{ type: 'text', text: finalText }] },
      {
        type: 'span.model_request_end',
        model_usage: { input_tokens: 1000, output_tokens: 500 },
      },
      { type: 'session.status_idle' },
    ])

    const result = await discoverSources({ ...baseArgs, anthropic })

    expect(result).toHaveLength(3)
    expect(result[0]?.listingUrl).toBe('https://metropool.nl/agenda')
    expect(result[0]?.score).toBe(9)
    expect(result[1]?.listingUrl).toBe('https://visittwente.nl/agenda')
    expect(anthropic.recordUsage).toHaveBeenCalledWith(
      'discovery:claude-sonnet-4-6',
      expect.objectContaining({ input_tokens: 1000, output_tokens: 500 }),
    )
  })

  it('uses the LAST fenced JSON block if the agent rewrites', async () => {
    const finalText = `Draft 1:
\`\`\`json
{ "candidates": [{ "url": "https://wrong.com/a", "domain": "wrong.com", "score": 5 }] }
\`\`\`

Updated after verification:
\`\`\`json
{ "candidates": [{ "url": "https://right.com/a", "domain": "right.com", "score": 8, "language": "nl" }] }
\`\`\`
`
    const anthropic = fakeAnthropic([
      { type: 'agent.message', content: [{ type: 'text', text: finalText }] },
      { type: 'session.status_idle' },
    ])
    const result = await discoverSources({ ...baseArgs, anthropic })
    expect(result).toHaveLength(1)
    expect(result[0]?.listingUrl).toBe('https://right.com/a')
  })

  it('falls back to bare {"candidates":[...]} object if no fence', async () => {
    const finalText = `Output: {"candidates": [{"url": "https://x.nl/", "domain": "x.nl", "score": 7}]}`
    const anthropic = fakeAnthropic([
      { type: 'agent.message', content: [{ type: 'text', text: finalText }] },
      { type: 'session.status_idle' },
    ])
    const result = await discoverSources({ ...baseArgs, anthropic })
    expect(result).toHaveLength(1)
    expect(result[0]?.listingUrl).toBe('https://x.nl/')
  })

  it('returns [] when the agent emits no parseable JSON', async () => {
    const anthropic = fakeAnthropic([
      {
        type: 'agent.message',
        content: [{ type: 'text', text: 'Sorry, I could not find anything useful.' }],
      },
      { type: 'session.status_idle' },
    ])
    const result = await discoverSources({ ...baseArgs, anthropic })
    expect(result).toEqual([])
  })

  it('throws on session.error', async () => {
    const anthropic = fakeAnthropic([
      { type: 'session.error', message: 'boom' },
    ])
    await expect(discoverSources({ ...baseArgs, anthropic })).rejects.toThrow(/session error/i)
  })

  it('clamps invalid scores into [0,10]', async () => {
    const finalText = `\`\`\`json
{ "candidates": [
  {"url":"https://a.nl/","domain":"a.nl","score":99},
  {"url":"https://b.nl/","domain":"b.nl","score":-5}
] }
\`\`\``
    const anthropic = fakeAnthropic([
      { type: 'agent.message', content: [{ type: 'text', text: finalText }] },
      { type: 'session.status_idle' },
    ])
    const result = await discoverSources({ ...baseArgs, anthropic })
    expect(result.map((r) => r.score).sort()).toEqual([0, 10])
  })
})
