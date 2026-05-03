import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDb>

export function createDb(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 5,
    fetch_types: false,
    prepare: false,
  })
  return drizzle(sql, { schema })
}

export { schema }
