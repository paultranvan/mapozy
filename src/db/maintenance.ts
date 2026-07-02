import type { Db } from './client';
import { CACHE_TTL_MS } from '../lib/overpass';

export const CACHE_CAP_BYTES = 4 * 1024 * 1024;

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
