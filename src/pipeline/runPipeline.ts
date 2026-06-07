// Rule implemented here: RULE_MIN_TRIP_DISTANCE (see ./rules.ts).
// All other pipeline rules fire inside the stage functions called below.
import type { Db } from '../db/client';
import type { RawActivity } from '../types';
import {
  getAllUnconsumedPoints,
  markPointsConsumed,
} from '../db/rawPoints';
import {
  getAllUnconsumedActivities,
  markActivitiesConsumed,
} from '../db/rawActivities';
import { findOrCreatePlace } from '../db/places';
import { insertTripWithSections } from '../db/trips';
import { getSetting, setSetting, SETTING_KEYS } from '../db/settings';
import { accuracyFilter } from './accuracyFilter';
import { segmentation } from './segmentation';
import { smoothing } from './smoothing';
import { resample } from './resample';
import { sectionSegmentation } from './sectionSegmentation';
import { assemble } from './assemble';
import { groupIntoTrips, type TripLegGroup } from './tripGrouping';
import { RULES } from './rules';
import { enrichTripTransit } from './transit/transitEnrichment';
import type { OverpassDeps } from '../lib/overpass';

export interface RunPipelineOpts {
  upToMs?: number;
  nowMs?: number;
  transit?: OverpassDeps;
}

export interface RunPipelineResult {
  tripsInserted: number;
  pointsConsumed: number;
  activitiesConsumed: number;
}

// Serialize pipeline runs per-db. The app fires runPipeline from three
// uncoordinated triggers (native MOVING→STATIONARY, app foreground/cold-start,
// and the manual "Force pipeline" button), all fire-and-forget. Without this,
// two overlapping runs each read the same unconsumed points and insert the
// same trip before either marks them consumed — producing byte-identical
// duplicate trip rows. Chaining makes every call wait for the in-flight run to
// finish (and mark its points consumed) before reading.
const pipelineChains = new WeakMap<Db, Promise<unknown>>();

export function runPipeline(
  db: Db,
  opts: RunPipelineOpts = {}
): Promise<RunPipelineResult> {
  const prev = pipelineChains.get(db) ?? Promise.resolve();
  const run = prev.then(
    () => runPipelineLocked(db, opts),
    () => runPipelineLocked(db, opts)
  );
  // Keep the chain alive even if this run rejects, so a failure doesn't wedge
  // every subsequent run. Callers still observe the rejection via `run`.
  pipelineChains.set(
    db,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

async function runPipelineLocked(
  db: Db,
  opts: RunPipelineOpts = {}
): Promise<RunPipelineResult> {
  const cutoff = opts.upToMs ?? Date.now();
  const now = opts.nowMs ?? Date.now();

  const allPoints = await getAllUnconsumedPoints(db);
  const points = allPoints.filter((p) => p.timestampMs <= cutoff);
  if (points.length < 2) {
    return { tripsInserted: 0, pointsConsumed: 0, activitiesConsumed: 0 };
  }
  const allActivities = await getAllUnconsumedActivities(db);
  const activities = allActivities.filter((a) => a.timestampMs <= cutoff);

  const filtered = accuracyFilter(points);
  if (filtered.length < 2) {
    await markPointsConsumed(db, points.map((p) => p.id));
    await markActivitiesConsumed(db, activities.map((a) => a.id));
    return {
      tripsInserted: 0,
      pointsConsumed: points.length,
      activitiesConsumed: activities.length,
    };
  }

  const segments = segmentation(filtered, activities);
  const groups = groupIntoTrips(segments);

  let tripsInserted = 0;
  let previousStayPlaceId: number | null = await readValidSeedPlaceId(db);
  let openTail: TripLegGroup | null = null;
  const enrichTargets: number[] = [];

  for (const group of groups) {
    if (group.endStay === null) {
      // Held for the next run — recorded; handled after the loop.
      openTail = group;
      break;
    }

    let startPlaceId = previousStayPlaceId;
    if (group.startStay !== null) {
      startPlaceId = await findOrCreatePlace(
        db,
        group.startStay.centerLat,
        group.startStay.centerLon,
        group.startStay.endMs
      );
    }
    const endPlaceId = await findOrCreatePlace(
      db,
      group.endStay.centerLat,
      group.endStay.centerLon,
      group.endStay.endMs
    );

    // When transit enrichment is requested, persist the trip as a draft up
    // front. Enrichment runs *after* points are marked consumed (below), so if
    // the process is killed during the slow Overpass calls the trip survives as
    // a draft and `refreshDraftTrips` re-enriches it — instead of leaving an
    // un-classified `car` trip whose points stay unconsumed and get re-inserted
    // as a duplicate on the next run.
    const tripId = await assembleAndPersist(
      db,
      group,
      activities,
      startPlaceId,
      endPlaceId,
      now,
      opts.transit != null
    );
    if (tripId !== null) {
      tripsInserted++;
      if (opts.transit) enrichTargets.push(tripId);
    }
    previousStayPlaceId = endPlaceId;
  }

  if (openTail !== null) {
    // Hold every raw point + activity from the open group's first leg
    // onward (covers leg points AND any break-stay points sitting between
    // legs inside the open group's span).
    const heldStartMs = openTail.legs[0]![0]!.timestampMs;
    await markPointsConsumed(
      db,
      points.filter((p) => p.timestampMs < heldStartMs).map((p) => p.id)
    );
    await markActivitiesConsumed(
      db,
      activities.filter((a) => a.timestampMs < heldStartMs).map((a) => a.id)
    );
  } else {
    await markPointsConsumed(db, points.map((p) => p.id));
    await markActivitiesConsumed(db, activities.map((a) => a.id));
  }

  if (previousStayPlaceId !== null) {
    await setSetting(
      db,
      SETTING_KEYS.LAST_KNOWN_PLACE_ID,
      String(previousStayPlaceId)
    );
  }

  // Transit enrichment runs only now that points are consumed and the run is
  // otherwise complete. It is best-effort and network-bound: a thrown error
  // (or the process dying mid-call) leaves the trip as a draft for
  // `refreshDraftTrips`, and can never cost us point-consumption tracking.
  if (opts.transit) {
    for (const tripId of enrichTargets) {
      try {
        await enrichTripTransit(opts.transit, tripId);
      } catch (err) {
        console.warn('[runPipeline] transit enrichment failed', err);
      }
    }
  }

  return {
    tripsInserted,
    pointsConsumed: points.length,
    activitiesConsumed: activities.length,
  };
}

async function readValidSeedPlaceId(db: Db): Promise<number | null> {
  const seedStr = await getSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID);
  if (!seedStr) return null;
  const seed = Number(seedStr);
  if (!Number.isFinite(seed)) return null;
  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM places WHERE id = ?`,
    seed
  );
  if (row) return seed;
  // Stale reference (e.g. previous "Clear all data"). Drop it so we don't
  // throw FOREIGN KEY on every trip insert until the user reinstalls.
  await setSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID, '');
  return null;
}

async function assembleAndPersist(
  db: Db,
  group: TripLegGroup,
  activities: RawActivity[],
  startPlaceId: number | null,
  endPlaceId: number | null,
  nowMs: number,
  pendingTransit: boolean
): Promise<number | null> {
  const legs = group.legs.map((rawPts) => {
    const smoothed = smoothing(rawPts);
    const resampled = resample(smoothed);
    const rawSections = sectionSegmentation(resampled, activities);
    return { rawSections };
  });

  if (legs.some((l) => l.rawSections.length === 0)) return null;

  const trip = assemble({
    legs,
    breaks: group.breaks,
    startPlaceId,
    endPlaceId,
    nowMs,
  });
  // RULE_MIN_TRIP_DISTANCE — threshold applies to the trip total.
  if (trip.distanceM < RULES.MIN_TRIP_DISTANCE.defaults.minTripDistanceM) {
    return null;
  }
  // Mark as a pending draft so a transit enrichment that never completes
  // (process killed mid-call) is retried by `refreshDraftTrips`. Successful
  // enrichment clears the draft.
  if (pendingTransit) {
    trip.draft = true;
    trip.draftReason = null;
  }
  return await insertTripWithSections(db, trip);
}
