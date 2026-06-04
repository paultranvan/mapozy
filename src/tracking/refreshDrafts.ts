import type { Db } from '../db/client';
import type { OverpassDeps } from '../lib/overpass';
import { listDraftTripIds } from '../db/trips';
import { enrichTripTransit } from '../pipeline/transit/transitEnrichment';
import { makeOverpassDeps } from './overpassDeps';

export interface RefreshDraftsResult {
  enriched: number;
  rateLimited: boolean;
}

/**
 * Re-run transit enrichment on every draft trip. Returns how many became fully
 * classified and whether Overpass rate-limited (so the UI can surface it). The
 * `deps` param is injectable for tests; the app uses the live-network default.
 */
export async function refreshDraftTrips(
  db: Db,
  deps: OverpassDeps = makeOverpassDeps(db)
): Promise<RefreshDraftsResult> {
  const ids = await listDraftTripIds(db);
  let enriched = 0;
  let rateLimited = false;
  for (const id of ids) {
    try {
      const res = await enrichTripTransit(deps, id);
      if (res.status === 'enriched') enriched++;
      if (res.reason === 'rate_limited') {
        rateLimited = true;
        break; // further calls would just hit the same 429
      }
    } catch (err) {
      console.warn('[refreshDraftTrips] enrichment failed for trip', id, err);
    }
  }
  return { enriched, rateLimited };
}
