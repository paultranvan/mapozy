import type { Db } from '../db/client';
import {
  getTripsByIds,
  getTripsOverlapping,
  getTripBefore,
  getTripAfter,
} from '../db/trips';
import { countPointsInRange } from '../db/rawPoints';

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

  const nextTrip = await getTripAfter(db, latestEndMs + 1);
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
