import Anthropic from '@anthropic-ai/sdk'
import type { ScrapeScenario } from './scenarios.ts'
import { EXTRACT_PROMPT } from './scenarios.ts'

export interface PathBItem {
  title: string
  url?: string
  startsAt?: string | null
  venueName?: string | null
  companyName?: string | null
  location?: string | null
  postedAt?: string | null
  description?: string | null
}

export interface PathBResult {
  scenarioId: string
  itemCount: number
  sampleTitles: string[]
  rawFinalText: string
  toolUses: number
  events: unknown[]
  elapsedSec: number
  sessionId: string
  finishedReason: 'idle' | 'timeout' | 'error'
  modelUsage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  error?: string
}

const SCRAPE_SYSTEM_PROMPT = `You are a web-scraping agent. The user will give you ONE URL and a schema. Your job:

1. Use web_fetch on the URL.
2. If the response is missing the listings (e.g. SPA shell, Cloudflare challenge, JS-only render), say so explicitly and try ONE alternative — fetch a likely alternate URL, follow a single redirect, or fetch a sub-route — but don't spin. If a single retry doesn't work, emit empty results and explain why.
3. Extract every listing on the page that matches the schema.
4. Emit ONE fenced \`\`\`json block matching the requested schema. No JSON outside the fence. Brief notes after.`

interface SetupHandles {
  client: Anthropic
  agentId: string
  environmentId: string
}

export async function setupAgentAndEnv(client: Anthropic): Promise<SetupHandles> {
  const agent = await client.beta.agents.create({
    name: 'dolimoyo-scrape-test',
    model: 'claude-sonnet-4-6',
    system: SCRAPE_SYSTEM_PROMPT,
    tools: [{ type: 'agent_toolset_20260401' }],
  })
  const environment = await client.beta.environments.create({
    name: 'dolimoyo-scrape-test-env',
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  })
  return { client, agentId: agent.id, environmentId: environment.id }
}

export async function runPathB(
  handles: SetupHandles,
  scenario: ScrapeScenario,
  opts: { timeoutMs: number },
): Promise<PathBResult> {
  const { client, agentId, environmentId } = handles
  const t0 = Date.now()

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: `scrape-test:${scenario.id}`,
  })

  const events: unknown[] = []
  const textChunks: string[] = []
  let toolUses = 0
  let finishedReason: PathBResult['finishedReason'] = 'idle'
  let error: string | undefined
  const modelUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }

  const stream = await client.beta.sessions.events.stream(session.id)

  const prompt = `URL: ${scenario.url}

Schema (emit fenced JSON exactly like this):

\`\`\`json
{
  "items": [
    ${
      scenario.kind === 'events'
        ? '{ "title": "...", "url": "...", "startsAt": "ISO-8601 or null", "venueName": "...", "description": "..." }'
        : '{ "title": "...", "url": "...", "companyName": "...", "location": "...", "postedAt": "ISO-8601 or null", "description": "..." }'
    }
  ]
}
\`\`\`

${EXTRACT_PROMPT(scenario.kind)}`

  await client.beta.sessions.events.send(session.id, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }],
  })

  const hardDeadline = Date.now() + opts.timeoutMs + 60_000
  const softTimer = setTimeout(() => {
    finishedReason = 'timeout'
    client.beta.sessions.events
      .send(session.id, {
        events: [
          {
            type: 'user.message',
            content: [
              {
                type: 'text',
                text:
                  "Time's up — emit your final JSON now with whatever you have. Empty items is fine.",
              },
            ],
          },
        ],
      })
      .catch(() => {})
  }, opts.timeoutMs)

  try {
    for await (const ev of stream as AsyncIterable<Record<string, unknown>>) {
      events.push(ev)
      const type = ev.type as string
      if (type === 'agent.message') {
        const content = (ev.content as Array<{ type: string; text?: string }>) ?? []
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') textChunks.push(block.text)
        }
      } else if (type === 'agent.tool_use') {
        toolUses++
      } else if (type === 'span.model_request_end') {
        const u = ev.model_usage as Record<string, number> | undefined
        if (u) {
          modelUsage.input_tokens += u.input_tokens ?? 0
          modelUsage.output_tokens += u.output_tokens ?? 0
          modelUsage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
          modelUsage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
        }
      } else if (type === 'session.status_idle') {
        break
      } else if (type === 'session.error' || type === 'agent.error') {
        error = JSON.stringify(ev).slice(0, 500)
        finishedReason = 'error'
        break
      }
      if (Date.now() > hardDeadline) {
        finishedReason = 'timeout'
        break
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    finishedReason = 'error'
  } finally {
    clearTimeout(softTimer)
  }

  const rawFinalText = textChunks.join('')
  const items = parseItems(rawFinalText)

  return {
    scenarioId: scenario.id,
    itemCount: items.length,
    sampleTitles: items.slice(0, 5).map((it) => it.title ?? '<no title>'),
    rawFinalText,
    toolUses,
    events,
    elapsedSec: (Date.now() - t0) / 1000,
    sessionId: session.id,
    finishedReason,
    modelUsage,
    error,
  }
}

function parseItems(text: string): PathBItem[] {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  for (let i = matches.length - 1; i >= 0; i--) {
    const body = matches[i]?.[1]?.trim()
    if (!body) continue
    try {
      const parsed = JSON.parse(body) as { items?: PathBItem[] }
      if (Array.isArray(parsed.items)) return parsed.items
    } catch {
      /* try next */
    }
  }
  return []
}

export function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')
  return new Anthropic({ apiKey })
}
