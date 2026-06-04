import { MapozyTracker } from 'mapozy-tracker';
import type { TrackingConfig } from 'mapozy-tracker';
import { runPipeline } from '../pipeline/runPipeline';
import type { Db } from '../db/client';
import { useQueryClient } from '@tanstack/react-query';
import { shouldRunPipelineForForeground } from './foregroundTrigger';
import { makeOverpassDeps } from './overpassDeps';

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

export async function runPipelineAndInvalidate(
  db: Db,
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  const r = await runPipeline(db, { transit: makeOverpassDeps(db) });
  if (r.tripsInserted > 0) {
    await qc.invalidateQueries({ queryKey: ['trips'] });
    await qc.invalidateQueries({ queryKey: ['stats'] });
    await qc.invalidateQueries({ queryKey: ['places'] });
  }
}

/**
 * Subscribe to the native MOVING→STATIONARY transition. Native fires this
 * once per trip end (STOP_TIMEOUT_MS of confirmed stillness, matching the
 * pipeline's DWELL_STAY threshold) so by the time JS receives it the
 * segmentation has a terminating stay at the new location and the pipeline
 * will persist the trip.
 *
 * The bus queues events emitted while the JS bridge is down, but the queue
 * is drained at native-module OnCreate — possibly before the JS layout
 * subscribes — so events fired while JS was dead can be lost in transit.
 * `runPipelineForForeground` covers that race by short-circuiting on a
 * `stationary` motionState at cold start.
 */
export function subscribeStationary(
  db: Db,
  qc: ReturnType<typeof useQueryClient>
): { remove: () => void } {
  const sub = MapozyTracker.addStationaryListener(() => {
    void runPipelineAndInvalidate(db, qc);
  });
  return sub;
}

/**
 * Cold-start / app-foreground pipeline trigger. Two paths:
 *
 *  1. Native motion state is already 'stationary' — the trip is over,
 *     drain unconditionally. Covers the case where `onStationary` fired
 *     while JS was dead and the queued event got lost during drain.
 *
 *  2. Otherwise fall back to the time gate: only run if the last raw point
 *     is old enough (idle threshold) or the backlog has been pending too
 *     long. Prevents fragmenting an in-progress trip when the user opens
 *     the app mid-drive.
 */
export async function runPipelineForForeground(
  db: Db,
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  const status = await MapozyTracker.getStatus().catch(() => null);
  if (status?.motionState === 'stationary') {
    await runPipelineAndInvalidate(db, qc);
    return;
  }
  const row = await db.getFirstAsync<{ last: number | null; oldest: number | null }>(
    `SELECT MAX(timestamp_ms) AS last, MIN(timestamp_ms) AS oldest
     FROM raw_points WHERE consumed=0`
  );
  const lastPointMs = row?.last ?? null;
  const oldestPointMs = row?.oldest ?? null;
  if (!shouldRunPipelineForForeground(lastPointMs, oldestPointMs, Date.now())) return;
  await runPipelineAndInvalidate(db, qc);
}
