import { useEffect, useRef } from 'react';
import { MapozyTracker } from 'mapozy-tracker';
import type { TrackingConfig } from 'mapozy-tracker';
import { useDb } from '../db/DbContext';
import { insertRawPoint } from '../db/rawPoints';
import { insertRawActivity } from '../db/rawActivities';
import { runPipeline } from '../pipeline/runPipeline';
import type { Db } from '../db/client';
import { useQueryClient } from '@tanstack/react-query';
import { shouldRunPipelineForForeground } from './foregroundTrigger';

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  distanceFilterMeters: 20,
  minTimeIntervalMs: 5000,
  desiredAccuracy: 'high',
  activityIntervalMs: 10_000,
  foregroundNotificationTitle: 'Mapozy tracking',
  foregroundNotificationBody: 'Tracking active',
};

export async function startTracking(
  cfg: TrackingConfig = DEFAULT_TRACKING_CONFIG
): Promise<void> {
  await MapozyTracker.start(cfg);
}

export async function stopTracking(): Promise<void> {
  await MapozyTracker.stop();
}

export async function isTracking(): Promise<boolean> {
  return MapozyTracker.isTracking();
}

export async function getTrackingStatus() {
  return MapozyTracker.getStatus();
}

// Opportunistic early pipeline run while JS is alive. Deliberately longer
// than segmentation's 5-min dwellMinutes default: segmentation should still
// treat a 5-min stop as a place visit, but the *pipeline* shouldn't fire
// so eagerly that a long-but-temporary stop (10 min in heavy traffic)
// gets processed before the trip actually completes.
const STILL_DRAIN_MS = 30 * 60_000;

/**
 * Subscribes to native location + activity events and persists them to SQLite.
 * Triggers a pipeline run when activity stays 'still' for the dwell threshold.
 */
export function useTrackerBridge() {
  const db = useDb();
  const qc = useQueryClient();
  const stillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const locSub = MapozyTracker.addLocationListener((loc) => {
      void insertRawPoint(db, {
        timestampMs: loc.timestampMs,
        latitude: loc.latitude,
        longitude: loc.longitude,
        altitude: loc.altitude,
        accuracyMeters: loc.accuracyMeters,
        speedMps: loc.speedMps,
        bearingDeg: loc.bearingDeg,
        batteryLevel: loc.batteryLevel,
        isCharging: loc.isCharging,
      });
    });

    const actSub = MapozyTracker.addActivityListener((act) => {
      void insertRawActivity(db, {
        timestampMs: act.timestampMs,
        type: act.type,
        confidence: act.confidence,
      });
      if (act.type === 'still' && act.confidence >= 60) {
        if (stillTimerRef.current) clearTimeout(stillTimerRef.current);
        stillTimerRef.current = setTimeout(
          () => {
            void runPipelineAndInvalidate(db, qc);
          },
          STILL_DRAIN_MS
        );
      } else if (act.type !== 'still' && stillTimerRef.current) {
        clearTimeout(stillTimerRef.current);
        stillTimerRef.current = null;
      }
    });

    return () => {
      locSub.remove();
      actSub.remove();
      if (stillTimerRef.current) clearTimeout(stillTimerRef.current);
    };
  }, [db, qc]);
}

export async function runPipelineAndInvalidate(
  db: Db,
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  const r = await runPipeline(db);
  if (r.tripsInserted > 0) {
    await qc.invalidateQueries({ queryKey: ['trips'] });
    await qc.invalidateQueries({ queryKey: ['stats'] });
    await qc.invalidateQueries({ queryKey: ['places'] });
  }
}

/**
 * Run the pipeline when it's safe to do so without fragmenting an
 * in-progress trip. "Safe" = the user looks idle (last raw point is
 * old enough that the trip likely ended) OR the pending backlog has
 * been sitting unprocessed long enough that we'd rather drain it than
 * keep accumulating (12h bypass — see foregroundTrigger.ts). Used by
 * the app-foreground trigger.
 */
export async function runPipelineForForeground(
  db: Db,
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  const row = await db.getFirstAsync<{ last: number | null; oldest: number | null }>(
    `SELECT MAX(timestamp_ms) AS last, MIN(timestamp_ms) AS oldest
     FROM raw_points WHERE consumed=0`
  );
  const lastPointMs = row?.last ?? null;
  const oldestPointMs = row?.oldest ?? null;
  if (!shouldRunPipelineForForeground(lastPointMs, oldestPointMs, Date.now())) return;
  await runPipelineAndInvalidate(db, qc);
}
