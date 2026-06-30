import type { Db } from '../db/client';
import type { OverpassDeps } from '../lib/overpass';
import { listDraftTripIds } from '../db/trips';
import { insertDiagnosticEvent } from '../db/diagnostics';
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
  deps: OverpassDeps | undefined = makeOverpassDeps(db)
): Promise<RefreshDraftsResult> {
  // External calls disabled → nothing to refresh; leave existing drafts as-is
  // until the user re-enables network access.
  if (!deps) return { enriched: 0, rateLimited: false };
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
      // A NON-Overpass throw escapes enrichTripTransit's typed catch, so the
      // trip is left as a draft with no draftReason and no refresh can clear it.
      // Persist it (not just console.warn) so the next export pins the cause.
      console.warn('[refreshDraftTrips] enrichment failed for trip', id, err);
      await insertDiagnosticEvent(db, Date.now(), 'transit_enrich_error', {
        source: 'refreshDraftTrips',
        tripId: id,
        message: String((err as Error)?.message ?? err),
        stack: (err as Error)?.stack ?? null,
      }).catch(() => {
        /* diagnostics are best-effort — never mask the original failure */
      });
    }
  }
  return { enriched, rateLimited };
}
