import type { Db } from './client';

// The Overpass transit cache lives in its OWN database file, not mapozy.db:
// it is disposable, re-downloadable data whose churn was bloating exports
// (78% of a tester DB) and fragmenting the main file. Deleting
// transit-cache.db wholesale is always a valid recovery.
export const TRANSIT_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS transit_cache (
  cell_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at_ms INTEGER NOT NULL
);
`;

export async function ensureTransitCacheSchema(db: Db): Promise<void> {
  await db.execAsync(TRANSIT_CACHE_SCHEMA);
}

let opening: Promise<Db> | null = null;

// Lazy singleton. expo-sqlite is imported dynamically so this module can be
// loaded under Node (tests, scripts/reprocess-db.ts) without expo present.
export function getTransitCacheDb(): Promise<Db> {
  if (opening === null) {
    opening = (async () => {
      const SQLite = await import('expo-sqlite');
      const db = await SQLite.openDatabaseAsync('transit-cache.db');
      await db.execAsync('PRAGMA journal_mode = TRUNCATE;');
      await ensureTransitCacheSchema(db);
      return db;
    })();
    // A failed open (e.g. disk pressure) must not wedge caching forever.
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}
