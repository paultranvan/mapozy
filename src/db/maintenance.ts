import type { Db } from './client';
import { CACHE_TTL_MS } from '../lib/overpass';
import { purgeOldConsumedPoints } from './rawPoints';
import { purgeOldConsumedActivities } from './rawActivities';
import { insertDiagnosticEvent } from './diagnostics';
import { getSetting, setSetting, SETTING_KEYS } from './settings';

export const RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const MAINTENANCE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
// VACUUM only when it will actually reclaim something: >20% of the file or
// >1 MB sitting on the freelist. SQLite never shrinks the file otherwise.
const VACUUM_MIN_FREE_RATIO = 0.2;
const VACUUM_MIN_FREE_BYTES = 1024 * 1024;

async function pragmaNumber(db: Db, name: string): Promise<number> {
  const row = await db.getFirstAsync<Record<string, number>>(`PRAGMA ${name}`);
  if (!row) return 0;
  const v = Object.values(row)[0];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

export async function maybeVacuum(db: Db): Promise<boolean> {
  const freelist = await pragmaNumber(db, 'freelist_count');
  const pages = await pragmaNumber(db, 'page_count');
  const pageSize = await pragmaNumber(db, 'page_size');
  const worthIt =
    pages > 0 &&
    (freelist / pages > VACUUM_MIN_FREE_RATIO || freelist * pageSize > VACUUM_MIN_FREE_BYTES);
  if (!worthIt) return false;
  // Accepted risk: the native tracker writes raw points into mapozy.db via
  // android.database.sqlite (outside the JS pipeline chain). A long VACUUM can
  // exceed its ~2.5s busy timeout and drop a fix (swallowed insert, no retry).
  // Bounded: at most once/day, pipeline fires when movement has stopped, and a
  // VACUUM that itself hits SQLITE_BUSY throws, is caught upstream, and retries
  // the next day.
  await db.execAsync('VACUUM');
  return true;
}

export interface MaintenanceResult {
  pointsPurged: number;
  activitiesPurged: number;
  cache: CacheEvictionResult | null;
  vacuumedMain: boolean;
  vacuumedCache: boolean;
}

/**
 * Daily DB upkeep, run at the end of a pipeline pass: purge consumed raw
 * rows past the 90-day retention window, evict the transit cache, and VACUUM
 * whichever file accumulated enough dead pages. Returns null when throttled.
 */
export async function runDbMaintenance(
  db: Db,
  cacheDb: Db | null,
  nowMs: number
): Promise<MaintenanceResult | null> {
  const last = await getSetting(db, SETTING_KEYS.LAST_DB_MAINTENANCE_MS);
  if (last !== null && nowMs - Number(last) < MAINTENANCE_MIN_INTERVAL_MS) return null;
  // Stamp before working so a crash mid-maintenance can't produce a daily
  // crash loop on the same data.
  await setSetting(db, SETTING_KEYS.LAST_DB_MAINTENANCE_MS, String(nowMs));

  const cutoff = nowMs - RAW_RETENTION_MS;
  const pointsPurged = await purgeOldConsumedPoints(db, cutoff);
  const activitiesPurged = await purgeOldConsumedActivities(db, cutoff);
  const cache = cacheDb ? await evictTransitCache(cacheDb, nowMs) : null;
  const vacuumedMain = await maybeVacuum(db);
  const vacuumedCache = cacheDb ? await maybeVacuum(cacheDb) : false;

  const result: MaintenanceResult = {
    pointsPurged,
    activitiesPurged,
    cache,
    vacuumedMain,
    vacuumedCache,
  };
  await insertDiagnosticEvent(db, nowMs, 'db_maintenance', result).catch(() => {
    /* diagnostics are best-effort */
  });
  return result;
}

// 32 MB: the cache lives in its own non-exported DB file, so the cap only
// protects device storage — and 4 MB could not even hold ONE long-distance
// ride's rail corridor (a single dense-area tile chunk response measured
// 1.7 MB on the 2026-07-14 export), forcing re-fetches on every recompute.
export const CACHE_CAP_BYTES = 32 * 1024 * 1024;

export interface CacheEvictionResult {
  rowsDeleted: number;
  bytesFreed: number;
}

async function cacheBytes(cacheDb: Db): Promise<number> {
  const row = await cacheDb.getFirstAsync<{ b: number | null }>(
    `SELECT SUM(LENGTH(payload)) AS b FROM transit_cache`
  );
  return row?.b ?? 0;
}

/**
 * Bound the transit cache: drop TTL-expired rows, legacy pre-tiling `ways:%`
 * keys, then — if the payload total still exceeds CACHE_CAP_BYTES — the
 * oldest-fetched rows until under the cap.
 */
export async function evictTransitCache(cacheDb: Db, nowMs: number): Promise<CacheEvictionResult> {
  const before = await cacheBytes(cacheDb);
  let rowsDeleted = 0;
  rowsDeleted += (
    await cacheDb.runAsync(`DELETE FROM transit_cache WHERE fetched_at_ms < ?`, nowMs - CACHE_TTL_MS)
  ).changes;
  rowsDeleted += (
    await cacheDb.runAsync(`DELETE FROM transit_cache WHERE cell_key LIKE 'ways:%'`)
  ).changes;
  // One row per iteration: `ways` payloads are large (tens of KB to MBs), so
  // few iterations ever run, and this can't overshoot below the cap.
  while ((await cacheBytes(cacheDb)) > CACHE_CAP_BYTES) {
    const r = await cacheDb.runAsync(
      `DELETE FROM transit_cache WHERE cell_key = (
         SELECT cell_key FROM transit_cache ORDER BY fetched_at_ms ASC LIMIT 1
       )`
    );
    rowsDeleted += r.changes;
    if (r.changes === 0) break;
  }
  return { rowsDeleted, bytesFreed: before - (await cacheBytes(cacheDb)) };
}
