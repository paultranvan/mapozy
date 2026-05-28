import { useEffect, useRef } from 'react';
import { MapozyTracker } from 'mapozy-tracker';
import type { TrackingConfig } from 'mapozy-tracker';
import { useDb } from '../db/DbContext';
import { runPipeline } from '../pipeline/runPipeline';
import type { Db } from '../db/client';
import { useQueryClient } from '@tanstack/react-query';
import { shouldRunPipelineForForeground } from './foregroundTrigger';

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
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

// Atomic re-subscribe — use this instead of stopTracking() + startTracking().
// The stop+start sequence races inside the native service: onDestroy fires
// after the new subscription is established and unsubscribes it again.
export async function restartTracking(): Promise<void> {
  await MapozyTracker.restart();
}

export async function isTracking(): Promise<boolean> {
  return MapozyTracker.isTracking();
}

export async function getTrackingStatus() {
  return MapozyTracker.getStatus();
}

/**
 * Subscribes to native location + activity events and persists them to SQLite.
 * Triggers a pipeline run when activity stays 'still' for the dwell threshold.
 */
const STILL_DRAIN_MS = 30 * 60_000;

export function useTrackerBridge() {
  const db = useDb();
  const qc = useQueryClient();
  const stillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const locSub = MapozyTracker.addLocationListener(() => {
      // persistence happens natively in NativeStore — JS listener is no-op
    });

    // Opportunistic early pipeline run: when JS happens to be alive and the
    // user has been still for STILL_DRAIN_MS, drain unconsumed rows now
    // instead of waiting for the next app foreground. Pure JS, no
    // side-effect on the native tracker — see also the foreground-trigger
    // in app/_layout.tsx.
    //
    // The 30-min threshold is deliberately longer than segmentation's 5-min
    // dwell threshold: segmentation should still treat a 5-min stop as a
    // place visit, but the *pipeline* shouldn't fire so eagerly that a
    // long-but-temporary stop (e.g. 10 min in heavy traffic) gets processed
    // before the trip actually completes.
    //
    // NOTE: We used to also call MapozyTracker.pauseLocation() / resumeLocation()
    // here to save battery during stillness. That was removed because the
    // resume side depended on a stable JS bridge, and an OS-killed JS instance
    // could leave the native module perpetually paused (observed in a real user
    // trip: 90 min of activity events with only 23 min of GPS coverage). If we
    // want this optimization back, it must live on the native side so its
    // resume can't be lost when JS is torn down.
    const actSub = MapozyTracker.addActivityListener((act) => {
      const isStill = act.type === 'still' && act.confidence >= 60;
      if (isStill) {
        if (stillTimerRef.current) return;
        stillTimerRef.current = setTimeout(() => {
          stillTimerRef.current = null;
          void runPipelineAndInvalidate(db, qc);
        }, STILL_DRAIN_MS);
      } else if (stillTimerRef.current) {
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
