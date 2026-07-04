import type { QueryClient } from '@tanstack/react-query';
import type { Db } from '../db/client';
import type { OverpassDeps } from '../lib/overpass';
import { listDraftTripIds } from '../db/trips';
import { insertDiagnosticEvent } from '../db/diagnostics';
import { enrichTripTransit } from '../pipeline/transit/transitEnrichment';
import { makeOverpassDeps } from './overpassDeps';
import { markEnrichmentProgress, markEnrichmentEnd } from './pipelineStatus';

export interface RefreshDraftsResult {
  enriched: number;
  rateLimited: boolean;
}

/**
 * Re-run transit enrichment on every draft trip. Returns how many became fully
 * classified and whether Overpass rate-limited (so the UI can surface it). The
 * `deps` param is injectable for tests; the app uses the live-network default.
 *
 * `onTripDone` fires after EACH trip that finished (enriched or re-drafted) so
 * the caller can refresh the UI incrementally instead of only at the end of a
 * potentially minutes-long pass.
 */
export async function refreshDraftTrips(
  db: Db,
  deps: OverpassDeps | undefined = makeOverpassDeps(db),
  onTripDone?: (remaining: number) => void | Promise<void>
): Promise<RefreshDraftsResult> {
  // External calls disabled → nothing to refresh; leave existing drafts as-is
  // until the user re-enables network access.
  if (!deps) return { enriched: 0, rateLimited: false };
  const ids = await listDraftTripIds(db);
  let enriched = 0;
  let rateLimited = false;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
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
    await onTripDone?.(ids.length - 1 - i);
  }
  return { enriched, rateLimited };
}

// ---------------------------------------------------------------------------
// Background single-flight wrapper — the ONLY draft-enrichment entry point the
// app should use. Enrichment is slow (network-bound Overpass/Valhalla) and used
// to run inline inside the serialized pipeline chain, blocking every queued
// pipeline run for its whole duration. Here it runs OUTSIDE that chain, one
// pass at a time: concurrent kicks coalesce into the in-flight pass (callers
// share its promise), and a second pass is queued at most once to pick up
// drafts inserted meanwhile.
// ---------------------------------------------------------------------------

// After Overpass 429s, hold off this long before a kick starts a new pass.
const RATE_LIMIT_BACKOFF_MS = 60_000;

let inFlight: Promise<RefreshDraftsResult> | null = null;
let rerunRequested = false;
let backoffUntilMs = 0;

/** Test-only: forget backoff/in-flight state between tests. */
export function _resetDraftEnrichmentStateForTests(): void {
  inFlight = null;
  rerunRequested = false;
  backoffUntilMs = 0;
}

async function invalidateTripQueries(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ queryKey: ['trips'] });
  await qc.invalidateQueries({ queryKey: ['stats'] });
}

/**
 * Run one background enrichment pass over all draft trips, refreshing the trip
 * and stats queries as each trip completes. Single-flight: while a pass is
 * active, callers get the in-flight promise back (and one follow-up pass is
 * scheduled so newly inserted drafts aren't missed). After a rate-limit the
 * next pass is refused for RATE_LIMIT_BACKOFF_MS — hammering Overpass again
 * immediately would only extend the 429.
 */
export function runDraftEnrichment(
  db: Db,
  qc: QueryClient,
  deps: OverpassDeps | undefined = makeOverpassDeps(db)
): Promise<RefreshDraftsResult> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  if (Date.now() < backoffUntilMs) {
    return Promise.resolve({ enriched: 0, rateLimited: true });
  }

  const pass = (async (): Promise<RefreshDraftsResult> => {
    let total: RefreshDraftsResult = { enriched: 0, rateLimited: false };
    try {
      do {
        rerunRequested = false;
        // Show the pass in the UI from its first moment; per-trip callbacks
        // below keep the remaining-count fresh as it drains.
        markEnrichmentProgress(await listDraftTripIds(db).then((d) => d.length).catch(() => 0));
        const res = await refreshDraftTrips(db, deps, async (remaining) => {
          markEnrichmentProgress(remaining);
          await invalidateTripQueries(qc).catch(() => {});
        });
        total = {
          enriched: total.enriched + res.enriched,
          rateLimited: res.rateLimited,
        };
        if (res.rateLimited) {
          backoffUntilMs = Date.now() + RATE_LIMIT_BACKOFF_MS;
          break;
        }
      } while (rerunRequested);
    } finally {
      markEnrichmentEnd();
      await invalidateTripQueries(qc).catch(() => {});
      inFlight = null;
    }
    return total;
  })();

  inFlight = pass;
  return pass;
}