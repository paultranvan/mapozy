import type { Db } from './client';
import type { Mode, Section, TripBreak } from '../types';
import {
  getTripById,
  getTripsByIds,
  setTripEditFlags,
  replaceTripSectionsAndBreaks,
  updateTripTimes,
  deleteTrip,
  insertTripWithSections,
} from './trips';
import { getSectionsForTrip, setSectionUserMode } from './sections';
import { getPlaceById, insertPlaceAt } from './places';
import { co2GramsForSection } from '../co2/compute';
import { haversineMeters } from '../lib/distance';
import { recomputeAndPersistTripAggregates } from './tripAggregates';
import { effectiveMode } from '../pipeline/effectiveMode';
import {
  mergeSectionPair,
  splitSectionAt,
  parseCoords,
} from '../pipeline/edits/sectionGeometry';
import { planRecompute, recomputeForTrips, MissingRawDataError } from '../pipeline/recomputeRange';
import { countPointsInRange } from './rawPoints';
import type { OverpassDeps } from '../lib/overpass';

// Two merged trips whose join is farther apart than this are treated as having
// an untracked gap between them (well above GPS endpoint jitter and the 100 m
// place-match radius), so the map draws a dashed connector across the jump.
const MERGE_GAP_M = 150;

/** Re-number sections 0..n-1 and recompute each section's co2 from effective mode. */
function renumberAndCost(sections: Section[]): Section[] {
  return sections.map((s, i) => ({
    ...s,
    ordering: i,
    co2G: co2GramsForSection(effectiveMode(s), s.distanceM),
  }));
}

/** Override one leg's mode. Trip stays recompute-eligible (edited, not locked). */
export async function setSectionMode(
  db: Db,
  tripId: number,
  sectionId: number,
  mode: Mode
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const sections = await getSectionsForTrip(db, tripId);
    const target = sections.find((s) => s.id === sectionId);
    if (!target) {
      throw new Error(`setSectionMode: section ${sectionId} not in trip ${tripId}`);
    }
    const co2 = co2GramsForSection(mode, target.distanceM);
    await setSectionUserMode(db, sectionId, mode, co2);
    await setTripEditFlags(db, tripId, true, false);
  });
  await recomputeAndPersistTripAggregates(db, tripId);
}

// NOTE: these structural ops are NOT wrapped in an outer transaction — the
// helpers they call (replaceTripSectionsAndBreaks, insertTripWithSections) open
// their own, and SQLite can't nest BEGIN. Each step is individually atomic; a
// mid-way failure leaves the trip in a recoverable state (re-run / Reset to
// auto), matching the auto-pipeline's recompute philosophy.
export async function mergeAdjacentSections(
  db: Db,
  tripId: number,
  ordering: number
): Promise<void> {
  const trip = await getTripById(db, tripId);
  if (!trip) throw new Error(`mergeAdjacentSections: trip ${tripId} not found`);
  const secs = trip.sections;
  if (ordering < 0 || ordering >= secs.length - 1) {
    throw new Error(`mergeAdjacentSections: no adjacent leg at ordering ${ordering}`);
  }
  const merged = mergeSectionPair(secs[ordering]!, secs[ordering + 1]!);
  const newSecs = renumberAndCost([
    ...secs.slice(0, ordering),
    merged,
    ...secs.slice(ordering + 2),
  ]);
  // Drop a break between the merged pair; shift higher break orderings down 1.
  const newBreaks: TripBreak[] = trip.breaks
    .filter((b) => b.ordering !== ordering)
    .map((b) => ({ ...b, ordering: b.ordering > ordering ? b.ordering - 1 : b.ordering }));
  await replaceTripSectionsAndBreaks(db, tripId, newSecs, newBreaks);
  await setTripEditFlags(db, tripId, true, true);
  await recomputeAndPersistTripAggregates(db, tripId);
}

export async function splitSection(
  db: Db,
  tripId: number,
  sectionId: number,
  vertexIndex: number
): Promise<void> {
  const trip = await getTripById(db, tripId);
  if (!trip) throw new Error(`splitSection: trip ${tripId} not found`);
  const idx = trip.sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) throw new Error(`splitSection: section ${sectionId} not in trip ${tripId}`);
  const [a, b] = splitSectionAt(trip.sections[idx]!, vertexIndex);
  const newSecs = renumberAndCost([
    ...trip.sections.slice(0, idx),
    a,
    b,
    ...trip.sections.slice(idx + 1),
  ]);
  // A break after the split section sits at ordering >= idx; shift up by 1.
  const newBreaks: TripBreak[] = trip.breaks.map((brk) => ({
    ...brk,
    ordering: brk.ordering >= idx ? brk.ordering + 1 : brk.ordering,
  }));
  await replaceTripSectionsAndBreaks(db, tripId, newSecs, newBreaks);
  await setTripEditFlags(db, tripId, true, true);
  await recomputeAndPersistTripAggregates(db, tripId);
}

export async function mergeTrips(
  db: Db,
  firstTripId: number,
  secondTripId: number
): Promise<void> {
  const first = await getTripById(db, firstTripId);
  const second = await getTripById(db, secondTripId);
  if (!first || !second) throw new Error('mergeTrips: trip not found');
  if (second.startTimeMs < first.startTimeMs) {
    throw new Error('mergeTrips: second trip must start after the first');
  }
  const offset = first.sections.length;
  const combinedSecs = renumberAndCost([...first.sections, ...second.sections]);

  // The stay between the two trips becomes a break at the boundary ordering.
  const boundaryOrdering = offset - 1;
  let centerLat = 0;
  let centerLon = 0;
  if (first.endPlaceId != null) {
    const p = await getPlaceById(db, first.endPlaceId);
    if (p) {
      centerLat = p.latitude;
      centerLon = p.longitude;
    }
  } else {
    const lastCoords = parseCoords(first.sections[first.sections.length - 1]!.geojson);
    const last = lastCoords[lastCoords.length - 1];
    if (last) {
      centerLon = last[0];
      centerLat = last[1];
    }
  }
  // If the two trips don't physically join up — the first ends well away from
  // where the second begins (an untracked ride between them, e.g. a bus while
  // GPS was suspended) — mark the boundary as a data gap so the map bridges it
  // with the dashed "gap" connector instead of leaving a silent straight-line
  // teleport between the two traces (tester: "I teleported after merging").
  const firstLastCoords = parseCoords(
    first.sections[first.sections.length - 1]?.geojson ?? '[]'
  );
  const firstLast = firstLastCoords[firstLastCoords.length - 1];
  const secondFirstCoords = parseCoords(second.sections[0]?.geojson ?? '[]');
  const secondFirst = secondFirstCoords[0];
  const boundaryGap =
    firstLast != null && secondFirst != null
      ? haversineMeters(firstLast[1], firstLast[0], secondFirst[1], secondFirst[0]) >
        MERGE_GAP_M
      : false;
  const boundaryBreak: TripBreak = {
    ordering: boundaryOrdering,
    startTimeMs: first.endTimeMs,
    endTimeMs: second.startTimeMs,
    centerLat,
    centerLon,
    gap: boundaryGap,
  };
  const combinedBreaks: TripBreak[] = [
    ...first.breaks,
    boundaryBreak,
    ...second.breaks.map((b) => ({ ...b, ordering: b.ordering + offset })),
  ];

  await deleteTrip(db, secondTripId);
  await replaceTripSectionsAndBreaks(db, firstTripId, combinedSecs, combinedBreaks);
  await updateTripTimes(db, firstTripId, first.startTimeMs, second.endTimeMs, second.endPlaceId);
  await setTripEditFlags(db, firstTripId, true, true);
  await recomputeAndPersistTripAggregates(db, firstTripId);
}

export interface SplitTripResult {
  firstTripId: number;
  secondTripId: number;
  placeId: number;
}

export async function splitTrip(
  db: Db,
  tripId: number,
  sectionId: number,
  vertexIndex: number
): Promise<SplitTripResult> {
  const trip = await getTripById(db, tripId);
  if (!trip || trip.id == null) throw new Error(`splitTrip: trip ${tripId} not found`);

  // 1. Split the chosen section so the cut lands on a section boundary.
  const idx = trip.sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) throw new Error(`splitTrip: section ${sectionId} not in trip`);
  const [a, b] = splitSectionAt(trip.sections[idx]!, vertexIndex);
  const allSecs = [...trip.sections.slice(0, idx), a, b, ...trip.sections.slice(idx + 1)];

  // The cut point is the shared vertex (end of a / start of b).
  const cutCoords = parseCoords(a.geojson);
  const cut = cutCoords[cutCoords.length - 1]!; // [lon, lat]
  const cutTimeMs = a.endTimeMs;

  // 2. Partition: first trip keeps sections [0..idx] (a is last), second gets [idx+1 (b)..].
  const firstSecs = renumberAndCost(allSecs.slice(0, idx + 1));
  const secondSecs = renumberAndCost(allSecs.slice(idx + 1));

  // Breaks at ordering < idx stay with trip1; >= idx move to trip2 (re-based).
  const firstBreaks: TripBreak[] = trip.breaks.filter((brk) => brk.ordering < idx);
  const secondBreaks: TripBreak[] = trip.breaks
    .filter((brk) => brk.ordering >= idx)
    .map((brk) => ({ ...brk, ordering: brk.ordering - (idx + 1) }));

  // 3. Create the shared place at the cut.
  const placeId = await insertPlaceAt(db, cut[1], cut[0], cutTimeMs);

  // 4. Trip1 keeps the id; rewrite its sections/breaks, end_place, times, lock.
  await replaceTripSectionsAndBreaks(db, tripId, firstSecs, firstBreaks);
  await updateTripTimes(db, tripId, trip.startTimeMs, cutTimeMs, placeId);
  await setTripEditFlags(db, tripId, true, true);

  // 5. Trip2 is a new row.
  const secondTrip = {
    id: 0,
    startTimeMs: cutTimeMs,
    endTimeMs: trip.endTimeMs,
    startPlaceId: placeId,
    endPlaceId: trip.endPlaceId,
    distanceM: 0,
    durationS: Math.max(1, Math.round((trip.endTimeMs - cutTimeMs) / 1000)),
    dominantMode: 'mixed' as const,
    co2G: 0,
    geojson: trip.geojson,
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: true,
    locked: true,
    createdAtMs: trip.createdAtMs,
    sections: secondSecs,
    breaks: secondBreaks,
  };
  const secondTripId = await insertTripWithSections(db, secondTrip);
  const result: SplitTripResult = { firstTripId: tripId, secondTripId, placeId };
  await recomputeAndPersistTripAggregates(db, result.firstTripId);
  await recomputeAndPersistTripAggregates(db, result.secondTripId);
  return result;
}

/**
 * Discard all manual edits on a trip and rebuild it (and its span) from raw
 * GPS. Unlocks first so the recompute treats it as eligible. `nowMs`/`transit`
 * pass through to the pipeline.
 */
export async function resetTripToAuto(
  db: Db,
  tripId: number,
  nowMs: number = Date.now(),
  transit?: OverpassDeps
): Promise<void> {
  // Check raw availability BEFORE discarding any edit state: reset on a
  // purged range must fail cleanly, not strip edits and then throw.
  const [trip] = await getTripsByIds(db, [tripId]);
  if (!trip) return;
  if ((await countPointsInRange(db, trip.startTimeMs, trip.endTimeMs)) < 2) {
    // Pipeline needs ≥ 2 raw points to rebuild; a single surviving point is
    // not enough to reconstruct the trip, so treat it like a purged range.
    throw new MissingRawDataError([tripId]);
  }

  // Clear overrides BEFORE recompute so they aren't snapshotted and reapplied
  // to the rebuilt sections — reset must discard every manual edit.
  await db.runAsync(
    `UPDATE sections SET user_mode = NULL WHERE trip_id = ?`,
    tripId
  );
  await setTripEditFlags(db, tripId, false, false);
  const plan = await planRecompute(db, [tripId], nowMs);
  await recomputeForTrips(db, plan, nowMs, transit);
}
