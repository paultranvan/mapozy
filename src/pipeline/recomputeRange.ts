import type { Db } from '../db/client';
import {
  getTripsByIds,
  getTripsOverlapping,
  getLockedTripsOverlapping,
  getTripBefore,
  getTripAfter,
  deleteTrips,
} from '../db/trips';
import { countPointsInRange, resetConsumedPointsInRange } from '../db/rawPoints';
import { resetConsumedActivitiesInRange } from '../db/rawActivities';
import { getSetting, setSetting, SETTING_KEYS } from '../db/settings';
import { runPipeline, type RunPipelineResult } from './runPipeline';
import { snapshotUserModes, reapplyUserModes } from './edits/reapplyUserModes';
import { recomputeAndPersistTripAggregates } from '../db/tripAggregates';
import type { OverpassDeps } from '../lib/overpass';

export interface RecomputePlan {
  selectedTripIds: number[];
  spanStartMs: number;
  spanEndMs: number; // half-open upper bound
  seedPlaceId: number | null;
  inRangeTripIds: number[];
  extraCount: number; // in-range trips not in selectedTripIds
  missingRawTripIds: number[];
  hasTripsAfterSpan: boolean;
  // Locked trips overlapping the span: never deleted, and their raw-point time
  // ranges are kept consumed so the pipeline doesn't recreate them.
  lockedRanges: [number, number][];
}

export async function planRecompute(
  db: Db,
  tripIds: number[],
  nowMs: number = Date.now()
): Promise<RecomputePlan> {
  const selected = await getTripsByIds(db, tripIds);
  if (selected.length === 0) {
    return {
      selectedTripIds: [],
      spanStartMs: 0,
      spanEndMs: 0,
      seedPlaceId: null,
      inRangeTripIds: [],
      extraCount: 0,
      missingRawTripIds: [],
      hasTripsAfterSpan: false,
      lockedRanges: [],
    };
  }

  const spanStartMs = Math.min(...selected.map((t) => t.startTimeMs));
  const latestEndMs = Math.max(...selected.map((t) => t.endTimeMs));

  const nextTrip = await getTripAfter(db, latestEndMs);
  const spanEndMs = nextTrip ? nextTrip.startTimeMs : nowMs;

  const prevTrip = await getTripBefore(db, spanStartMs);
  const seedPlaceId = prevTrip ? prevTrip.endPlaceId : null;

  const inRange = await getTripsOverlapping(db, spanStartMs, spanEndMs);
  const lockedSet = new Set(
    (await getLockedTripsOverlapping(db, spanStartMs, spanEndMs)).map((t) => t.id!)
  );
  // Locked trips are user-curated: never delete or reprocess them.
  const deletable = inRange.filter((t) => !lockedSet.has(t.id!));
  const lockedRanges = inRange
    .filter((t) => lockedSet.has(t.id!))
    .map((t) => [t.startTimeMs, t.endTimeMs] as [number, number]);

  const selectedSet = new Set(tripIds);
  const extraCount = deletable.filter((t) => !selectedSet.has(t.id!)).length;

  const missingRawTripIds: number[] = [];
  for (const t of deletable) {
    const n = await countPointsInRange(db, t.startTimeMs, t.endTimeMs);
    if (n === 0) missingRawTripIds.push(t.id!);
  }

  return {
    selectedTripIds: tripIds,
    spanStartMs,
    spanEndMs,
    seedPlaceId,
    inRangeTripIds: deletable.map((t) => t.id!),
    extraCount,
    missingRawTripIds,
    hasTripsAfterSpan: nextTrip !== null,
    lockedRanges,
  };
}

// Assumes the span is historical: spanEndMs is a past timestamp (the next
// trip's start, or now). Resetting consumed flags over [spanStartMs, spanEndMs]
// and re-running the pipeline up to spanEndMs therefore only ever reprocesses
// the span's own raw data, never an in-progress live tail (whose points are
// newer than spanEndMs). Not atomic — runPipeline transacts per trip insert; a
// mid-way failure leaves the span partially rebuilt and is recovered by simply
// re-running recompute (or the whole-DB reprocess script).
// Complement of `locked` intervals within [start, end), as sorted sub-ranges.
function unlockedSubRanges(
  start: number,
  end: number,
  locked: [number, number][]
): [number, number][] {
  const sorted = [...locked].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cursor = start;
  for (const [ls, le] of sorted) {
    const s = Math.max(start, ls);
    const e = Math.min(end, le);
    if (s > cursor) out.push([cursor, s]);
    if (e > cursor) cursor = e;
  }
  if (cursor < end) out.push([cursor, end]);
  return out;
}

export async function recomputeForTrips(
  db: Db,
  plan: RecomputePlan,
  nowMs: number = Date.now(),
  transit?: OverpassDeps
): Promise<RunPipelineResult> {
  if (plan.inRangeTripIds.length === 0) {
    return { tripsInserted: 0, pointsConsumed: 0, activitiesConsumed: 0 };
  }

  const savedSeed = await getSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID);

  // Capture mode overrides so a no-op rebuild (identical section bounds) keeps
  // the user's edits; a structural rebuild drops the now-orphaned overrides.
  const userModeSnapshot = await snapshotUserModes(db, plan.inRangeTripIds);

  await deleteTrips(db, plan.inRangeTripIds);
  // Reset consumed flags only OUTSIDE locked trips' ranges, so the pipeline
  // re-segments the unlocked gaps while leaving locked trips' points consumed
  // (and thus their trips intact).
  const subRanges = unlockedSubRanges(plan.spanStartMs, plan.spanEndMs, plan.lockedRanges);
  for (const [s, e] of subRanges) {
    await resetConsumedPointsInRange(db, s, e);
    await resetConsumedActivitiesInRange(db, s, e);
  }

  // Seed the span's first trip from the place the user was at before the span.
  await setSetting(
    db,
    SETTING_KEYS.LAST_KNOWN_PLACE_ID,
    plan.seedPlaceId === null ? '' : String(plan.seedPlaceId)
  );

  const result = await runPipeline(db, { upToMs: plan.spanEndMs, nowMs, transit });

  // Reapply mode overrides to rebuilt sections with matching bounds, then
  // refresh aggregates for any trip that regained an override.
  await reapplyUserModes(db, userModeSnapshot);
  for (const t of await getTripsOverlapping(db, plan.spanStartMs, plan.spanEndMs)) {
    if (t.id != null && t.edited) await recomputeAndPersistTripAggregates(db, t.id);
  }

  // If trips still exist after the span, the live last-known place is theirs,
  // not the span's — restore what we saved so live tracking is unaffected.
  if (plan.hasTripsAfterSpan) {
    await setSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID, savedSeed ?? '');
  }

  return result;
}
