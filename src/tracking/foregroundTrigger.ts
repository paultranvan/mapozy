import type { AppStateStatus } from 'react-native';

export const FOREGROUND_IDLE_THRESHOLD_MS = 30 * 60_000;

// If unconsumed data is older than this, force a pipeline run even when
// the user appears to still be in motion — otherwise constant-travel
// scenarios (long flights, road trips, multi-day backpacking) would
// accumulate raw rows indefinitely.
export const FOREGROUND_STALE_BYPASS_MS = 12 * 60 * 60_000;

export function shouldRunPipelineOnAppStateChange(
  next: AppStateStatus,
  prev: AppStateStatus
): boolean {
  return prev !== 'active' && next === 'active';
}

/**
 * Whether enough time has passed since the last recorded raw point that
 * the user is unlikely to still be in an active trip. Used to gate the
 * foreground-trigger so we don't fragment an in-progress trip by running
 * the pipeline on partial data.
 */
export function isIdleSinceLastPoint(
  lastPointMs: number | null,
  nowMs: number,
  thresholdMs: number = FOREGROUND_IDLE_THRESHOLD_MS
): boolean {
  if (lastPointMs === null) return true;
  return nowMs - lastPointMs >= thresholdMs;
}

/**
 * Combined foreground-trigger decision: fire if the user looks idle
 * (last raw point is older than `idleThresholdMs`) OR if pending data
 * has been sitting unprocessed longer than `staleBypassMs` (so we don't
 * accumulate unbounded raw rows during continuous-travel scenarios).
 */
export function shouldRunPipelineForForeground(
  lastPointMs: number | null,
  oldestPointMs: number | null,
  nowMs: number,
  idleThresholdMs: number = FOREGROUND_IDLE_THRESHOLD_MS,
  staleBypassMs: number = FOREGROUND_STALE_BYPASS_MS
): boolean {
  if (isIdleSinceLastPoint(lastPointMs, nowMs, idleThresholdMs)) return true;
  if (oldestPointMs !== null && nowMs - oldestPointMs >= staleBypassMs) return true;
  return false;
}

export interface MotionGateInput {
  isTracking: boolean;
  motionState: 'moving' | 'stationary' | null;
}

/**
 * Pure gate for "soft" triggers (screen focus, pull-to-refresh, banner tap):
 * run the pipeline unless a trip is actively in progress. A trip can only be
 * in progress while we are BOTH tracking and moving — running then would
 * fragment it. Running while stationary is the safe moment (segmentation sees
 * a terminating stay).
 *
 * The `isTracking` guard matters: the native motionState is persisted and
 * defaults to 'moving' on a fresh install / before tracking ever starts, so
 * gating on motionState alone would wrongly block every run until the tracker
 * has first declared a stationary state.
 */
export function shouldRunGivenMotion(input: MotionGateInput): boolean {
  return !(input.isTracking && input.motionState === 'moving');
}
