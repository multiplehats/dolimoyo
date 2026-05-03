import { schema, type Database } from '@uitagenda/db'

export interface LedgerEntry {
  provider: 'parsew' | 'openrouter' | 'autosend'
  endpoint: string
  costUnits: number | string
  sourceId?: string | null
  subscriptionId?: string | null
  metadata?: Record<string, unknown>
}

export function createLedger(db: Database) {
  return {
    record: async (entry: LedgerEntry) => {
      try {
        await db.insert(schema.apiCalls).values({
          provider: entry.provider,
          endpoint: entry.endpoint,
          costUnits: typeof entry.costUnits === 'number' ? entry.costUnits.toString() : entry.costUnits,
          sourceId: entry.sourceId ?? null,
          subscriptionId: entry.subscriptionId ?? null,
          metadata: entry.metadata,
        })
      } catch (err) {
        console.error('ledger insert failed', err)
      }
    },
  }
}
