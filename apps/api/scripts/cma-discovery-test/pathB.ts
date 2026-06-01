import Anthropic from '@anthropic-ai/sdk'
import type { Scenario } from './scenarios.ts'

export interface PathBCandidate {
  url: string
  domain: string
  reason: string
  freshness_evidence: string
  language: string
}

export interface PathBResult {
  scenarioId: string
  candidates: PathBCandidate[]
  rawFinalText: string
  toolUses: Array<{ name: string; input?: unknown }>
  events: unknown[]
  elapsedSec: number
  sessionId: string
  agentId: string
  environmentId: string
  finishedReason: 'idle' | 'timeout' | 'error'
  error?: string
}

interface SetupHandles {
  client: Anthropic
  agentId: string
  agentVersion: number
  environmentId: string
}

export async function setupAgentAndEnv(client: Anthropic, systemPrompt: string): Promise<SetupHandles> {
  const agent = await client.beta.agents.create({
    name: 'dolimoyo-discovery-research',
    // Sonnet to keep the comparison comparable to the current pipeline's
    // hardest call (scraperGen uses sonnet-4.6). Opus would cost ~5x and
    // likely change quality at margins we don't care about for this test.
    model: 'claude-sonnet-4-6',
    system: systemPrompt,
    tools: [{ type: 'agent_toolset_20260401' }],
  })
  const environment = await client.beta.environments.create({
    name: 'dolimoyo-discovery-env',
    config: {
      type: 'cloud',
      networking: { type: 'unrestricted' },
    },
  })
  return {
    client,
    agentId: agent.id,
    agentVersion: agent.version,
    environmentId: environment.id,
  }
}

const SYSTEM_PROMPT = `You are a hyperlocal web-research agent. Your job is to find high-quality listing websites for a personalised digest service.

You have access to web search and web fetch in a sandbox. Your output is consumed programmatically — when you finish, emit ONE fenced JSON block matching the schema in the user's task. No JSON outside the fence, no second fence with different content. After the JSON, you may add brief notes if you want.

Be skeptical. Verify candidates with web_fetch before listing them — confirm the page actually shows multiple recent entries. Never list a URL you haven't opened.`

export async function runPathB(
  handles: SetupHandles,
  scenario: Scenario,
  opts: { timeoutMs: number },
): Promise<PathBResult> {
  const { client, agentId, environmentId } = handles
  const t0 = Date.now()

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: `discovery-test:${scenario.id}`,
  })

  const events: unknown[] = []
  const toolUses: PathBResult['toolUses'] = []
  const textChunks: string[] = []
  let finishedReason: PathBResult['finishedReason'] = 'idle'
  let error: string | undefined

  const stream = await client.beta.sessions.events.stream(session.id)

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: scenario.pathB.prompt }],
      },
    ],
  })

  const timeoutHandle = setTimeout(() => {
    finishedReason = 'timeout'
    try {
      // Best-effort interrupt; if it fails just let the stream race close.
      client.beta.sessions.events
        .send(session.id, {
          events: [
            {
              type: 'user.message',
              content: [
                {
                  type: 'text',
                  text:
                    "Time's up — STOP all further research now. Emit your final JSON block immediately with whatever verified candidates you have so far. Then stop.",
                },
              ],
            },
          ],
        })
        .catch(() => {})
    } catch {
      /* ignore */
    }
  }, opts.timeoutMs)

  const hardKillAt = Date.now() + opts.timeoutMs + 60_000

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
        toolUses.push({ name: ev.name as string, input: ev.input })
      } else if (type === 'session.status_idle') {
        break
      } else if (type === 'session.error' || type === 'agent.error') {
        error = JSON.stringify(ev)
        finishedReason = 'error'
        break
      }
      if (Date.now() > hardKillAt) {
        finishedReason = 'timeout'
        break
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    finishedReason = 'error'
  } finally {
    clearTimeout(timeoutHandle)
  }

  const rawFinalText = textChunks.join('')
  const candidates = parseCandidates(rawFinalText)

  return {
    scenarioId: scenario.id,
    candidates,
    rawFinalText,
    toolUses,
    events,
    elapsedSec: (Date.now() - t0) / 1000,
    sessionId: session.id,
    agentId,
    environmentId,
    finishedReason,
    error,
  }
}

function parseCandidates(text: string): PathBCandidate[] {
  // Pull the last fenced JSON block. The agent may emit more than one if it
  // rewrites — we want the final one.
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  for (let i = matches.length - 1; i >= 0; i--) {
    const body = matches[i]?.[1]?.trim()
    if (!body) continue
    try {
      const parsed = JSON.parse(body) as { candidates?: PathBCandidate[] }
      if (Array.isArray(parsed.candidates)) return parsed.candidates
    } catch {
      // try next-most-recent
    }
  }
  // Last-ditch: try to find any { "candidates": [...] } object directly.
  const obj = text.match(/\{\s*"candidates"\s*:\s*\[[\s\S]*?\]\s*\}/)
  if (obj) {
    try {
      const parsed = JSON.parse(obj[0]) as { candidates?: PathBCandidate[] }
      if (Array.isArray(parsed.candidates)) return parsed.candidates
    } catch {
      /* ignore */
    }
  }
  return []
}

export function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')
  return new Anthropic({ apiKey })
}

export { SYSTEM_PROMPT }
