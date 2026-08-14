import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type DB = BetterSQLite3Database<typeof schema>

export interface DatabaseHandle {
  db: DB
  sqlite: Database.Database
  close(): void
}

/**
 * Opens (or creates) the application database and brings it up to the latest
 * migration. `:memory:` is accepted for tests.
 */
export function openDatabase(file: string, migrationsFolder: string): DatabaseHandle {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  return {
    db,
    sqlite,
    close: () => sqlite.close()
  }
}

export { schema }
