import {
  Parsew,
  ParsewError,
  type ScrapeResult,
  type ExtractResult,
  type MapResult,
  type ScrapeOptions,
  type ExtractOptions,
  type MapOptions,
} from '@parsew/sdk/server'

export interface SearchOptions {
  limit?: number
  language?: string
  country?: string
}

export interface SearchResult {
  results: { url: string; title: string; description?: string }[]
}

export interface ParsewLedgerEvent {
  endpoint: 'scrape' | 'extract' | 'map' | 'search'
  costUnits: number
}

export interface ParsewClientOptions {
  apiKey: string
  baseUrl?: string
  timeout?: number
  maxRetries?: number
  onCall?: (e: ParsewLedgerEvent) => void
}

export interface ParsewClient {
  scrape: (url: string, options?: ScrapeOptions) => Promise<ScrapeResult>
  extract: <T>(url: string, options: ExtractOptions<T>) => Promise<ExtractResult<T>>
  map: (url: string, options?: MapOptions) => Promise<MapResult>
  search: (query: string, options?: SearchOptions) => Promise<SearchResult>
}

const COST: Record<ParsewLedgerEvent['endpoint'], number> = {
  scrape: 1,
  extract: 5,
  map: 1,
  search: 1,
}

export function createParsewClient(options: ParsewClientOptions): ParsewClient {
  if (!options.apiKey?.trim()) throw new Error('Parsew api key is required')

  const inner = new Parsew({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    timeout: options.timeout,
  })

  const baseUrl = (options.baseUrl ?? 'https://api.parsew.com').replace(/\/$/, '')
  const maxRetries = options.maxRetries ?? 2
  const onCall = options.onCall

  function wrap<A extends unknown[], R>(
    endpoint: ParsewLedgerEvent['endpoint'],
    fn: (...args: A) => Promise<R>,
  ) {
    return async (...args: A): Promise<R> => {
      let lastErr: unknown
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await fn(...args)
          onCall?.({ endpoint, costUnits: COST[endpoint] })
          return result
        } catch (err) {
          lastErr = err
          if (!isRetryable(err) || attempt === maxRetries) throw err
          await sleep(2 ** attempt * 500)
        }
      }
      throw lastErr
    }
  }

  return {
    scrape: wrap('scrape', inner.scrape.bind(inner)),
    extract: wrap('extract', inner.extract.bind(inner)) as ParsewClient['extract'],
    map: wrap('map', inner.map.bind(inner)),
    search: wrap('search', searchFor(baseUrl, options.apiKey, options.timeout ?? 60_000)),
  }
}

function searchFor(baseUrl: string, apiKey: string, timeout: number) {
  return async (query: string, options?: SearchOptions): Promise<SearchResult> => {
    const body: Record<string, unknown> = { query }
    if (options?.limit) body.limit = options.limit
    if (options?.language) body.lang = options.language
    if (options?.country) body.country = options.country
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(`${baseUrl}/v1/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new ParsewError(json.error ?? res.statusText, res.status, `HTTP_${res.status}`)
      }
      return res.json() as Promise<SearchResult>
    } finally {
      clearTimeout(timer)
    }
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ParsewError) return err.status >= 500 || err.status === 429
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export type { ScrapeResult, ExtractResult, MapResult }
export { ParsewError }
