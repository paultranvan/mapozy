import type { Db } from '../db/client';
import {
  getTripsByIds,
  getTripsOverlapping,
  getTripBefore,
  getTripAfter,
  deleteTrips,
} from '../db/trips';
import { countPointsInRange, resetConsumedPointsInRange } from '../db/rawPoints';
import { resetConsumedActivitiesInRange } from '../db/rawActivities';
import { getSetting, setSetting, SETTING_KEYS } from '../db/settings';
import { runPipeline, type RunPipelineResult } from './runPipeline';

export interface RecomputePlan {
  selectedTripIds: number[];
  spanStartMs: number;
  spanEndMs: number; // half-open upper bound
  seedPlaceId: number | null;
  inRangeTripIds: number[];
  extraCount: number; // in-range trips not in selectedTripIds
  missingRawTripIds: number[];
  hasTripsAfterSpan: boolean;
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
    };
  }

  const spanStartMs = Math.min(...selected.map((t) => t.startTimeMs));
  const latestEndMs = Math.max(...selected.map((t) => t.endTimeMs));

  const nextTrip = await getTripAfter(db, latestEndMs);
  const spanEndMs = nextTrip ? nextTrip.startTimeMs : nowMs;

  const prevTrip = await getTripBefore(db, spanStartMs);
  const seedPlaceId = prevTrip ? prevTrip.endPlaceId : null;

  const inRange = await getTripsOverlapping(db, spanStartMs, spanEndMs);
  const selectedSet = new Set(tripIds);
  const extraCount = inRange.filter((t) => !selectedSet.has(t.id!)).length;

  const missingRawTripIds: number[] = [];
  for (const t of inRange) {
    const n = await countPointsInRange(db, t.startTimeMs, t.endTimeMs);
    if (n === 0) missingRawTripIds.push(t.id!);
  }

  return {
    selectedTripIds: tripIds,
    spanStartMs,
    spanEndMs,
    seedPlaceId,
    inRangeTripIds: inRange.map((t) => t.id!),
    extraCount,
    missingRawTripIds,
    hasTripsAfterSpan: nextTrip !== null,
  };
}

export async function recomputeForTrips(
  db: Db,
  plan: RecomputePlan,
  nowMs: number = Date.now()
): Promise<RunPipelineResult> {
  if (plan.inRangeTripIds.length === 0) {
    return { tripsInserted: 0, pointsConsumed: 0, activitiesConsumed: 0 };
  }

  const savedSeed = await getSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID);

  await deleteTrips(db, plan.inRangeTripIds);
  await resetConsumedPointsInRange(db, plan.spanStartMs, plan.spanEndMs);
  await resetConsumedActivitiesInRange(db, plan.spanStartMs, plan.spanEndMs);

  // Seed the span's first trip from the place the user was at before the span.
  await setSetting(
    db,
    SETTING_KEYS.LAST_KNOWN_PLACE_ID,
    plan.seedPlaceId === null ? '' : String(plan.seedPlaceId)
  );

  const result = await runPipeline(db, { upToMs: plan.spanEndMs, nowMs });

  // If trips still exist after the span, the live last-known place is theirs,
  // not the span's — restore what we saved so live tracking is unaffected.
  if (plan.hasTripsAfterSpan) {
    await setSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID, savedSeed ?? '');
  }

  return result;
}
