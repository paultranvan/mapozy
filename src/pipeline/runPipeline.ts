import type { Db } from '../db/client';
import type { RawPoint, RawActivity } from '../types';
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

export interface RunPipelineOpts {
  upToMs?: number;
  nowMs?: number;
}

const MIN_TRIP_DISTANCE_M = 100;

export interface RunPipelineResult {
  tripsInserted: number;
  pointsConsumed: number;
  activitiesConsumed: number;
}

export async function runPipeline(
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

  let tripsInserted = 0;
  const seedStr = await getSetting(db, SETTING_KEYS.LAST_KNOWN_PLACE_ID);
  const seed = seedStr ? Number(seedStr) : NaN;
  let previousStayPlaceId: number | null = Number.isFinite(seed) ? seed : null;
  let pendingTrip: RawPoint[] | null = null;

  for (const seg of segments) {
    if (seg.kind === 'stay') {
      const placeId = await findOrCreatePlace(
        db,
        seg.centerLat,
        seg.centerLon,
        seg.endMs
      );
      if (pendingTrip) {
        const inserted = await assembleAndPersist(
          db,
          pendingTrip,
          activities,
          previousStayPlaceId,
          placeId,
          now
        );
        if (inserted) tripsInserted++;
        pendingTrip = null;
      }
      previousStayPlaceId = placeId;
    } else {
      pendingTrip = seg.points;
    }
  }

  if (pendingTrip) {
    const heldPointIds = new Set(pendingTrip.map((p) => p.id));
    const heldStartMs = pendingTrip[0]!.timestampMs;
    await markPointsConsumed(
      db,
      points.filter((p) => !heldPointIds.has(p.id)).map((p) => p.id)
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

  return {
    tripsInserted,
    pointsConsumed: points.length,
    activitiesConsumed: activities.length,
  };
}

async function assembleAndPersist(
  db: Db,
  rawPts: RawPoint[],
  activities: RawActivity[],
  startPlaceId: number | null,
  endPlaceId: number | null,
  nowMs: number
): Promise<boolean> {
  const smoothed = smoothing(rawPts);
  const resampled = resample(smoothed);
  const rawSections = sectionSegmentation(resampled, activities);
  if (rawSections.length === 0) return false;
  const trip = assemble({ rawSections, startPlaceId, endPlaceId, nowMs });
  if (trip.distanceM < MIN_TRIP_DISTANCE_M) return false;
  await insertTripWithSections(db, trip);
  return true;
}
