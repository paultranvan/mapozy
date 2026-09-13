/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/**
 * Run the ONLINE transit enrichment (Overpass transit + Valhalla map-matching)
 * on a handful of trips of a (reprocessed) export, in place. Handy to check
 * what the app would show for a few trips without enriching the whole
 * history (which takes ~1 h on a summer's worth of data).
 *
 * Usage: npx tsx scripts/enrich-trips.ts <db> <tripId>[,<tripId>...]
 * Overpass responses are cached in `<db>.transit-cache.db` next to the DB.
 */
import { makeAdapter } from './lib/betterSqliteAdapter';
import { TRANSIT_CACHE_SCHEMA } from '../src/db/transitCacheDb';
import { enrichTripTransit } from '../src/pipeline/transit/transitEnrichment';
import { getTripById } from '../src/db/trips';

async function main() {
  const [dbPath, idList] = process.argv.slice(2);
  if (!dbPath || !idList) {
    console.error('Usage: enrich-trips <db> <tripId>[,<tripId>...]');
    process.exit(1);
  }
  const Better = require('better-sqlite3');
  const raw = new Better(dbPath);
  raw.pragma('journal_mode = TRUNCATE');
  raw.pragma('foreign_keys = ON');
  const db = makeAdapter(raw) as any;
  const cacheRaw = new Better(`${dbPath}.transit-cache.db`);
  cacheRaw.pragma('journal_mode = TRUNCATE');
  cacheRaw.exec(TRANSIT_CACHE_SCHEMA);
  const cacheDb = makeAdapter(cacheRaw) as any;
  const deps = { db, cacheDb: async () => cacheDb, fetchFn: fetch };

  for (const idStr of idList.split(',')) {
    const id = Number(idStr);
    const t0 = Date.now();
    const r = await enrichTripTransit(deps, id);
    const trip = await getTripById(db, id);
    const secs = trip?.sections
      .map((s) => `${s.mode}${s.modeSource ? '(' + s.modeSource + ')' : ''}:${Math.round(s.distanceM)}m`)
      .join(' ');
    console.log(
      `trip ${id}: ${r.status}${r.reason ? ' ' + r.reason : ''} changed=${r.changed} in ${Math.round((Date.now() - t0) / 1000)}s → ${trip?.dominantMode} | ${secs}`
    );
  }
  raw.close();
  cacheRaw.close();
}

main();
