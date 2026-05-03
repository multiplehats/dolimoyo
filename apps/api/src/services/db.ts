import { createDb, type Database } from '@uitagenda/db'
import type { Env } from '../env'

export function createDbForEnv(env: Env): Database {
  return createDb(env.HYPERDRIVE.connectionString)
}

export type { Database }
