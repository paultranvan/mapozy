import { DIAGNOSTIC_EVENTS, listDiagnosticEvents } from '../db/diagnostics';
import type { DiagnosticEvent } from '../db/diagnostics';
import type { Db } from '../db/client';

export type InterruptionCause =
  | 'device_off'
  | 'killed_recovered'
  | 'killed_until_reopen'
  | 'ongoing';

export interface Interruption {
  startMs: number;
  endMs: number;
  durationMs: number;
  cause: InterruptionCause;
}

// A gap counts as an interruption only if it exceeds the heartbeat interval by
// this factor — tolerates up to 4 missed Doze beats without crying wolf.
export const GAP_FACTOR = 5;

// Event types that prove the service was alive at that instant.
const LIVENESS_EVENT_TYPES: ReadonlySet<string> = new Set([
  DIAGNOSTIC_EVENTS.WATCHDOG_FIRE,
  DIAGNOSTIC_EVENTS.WATCHDOG_RESTART,
  DIAGNOSTIC_EVENTS.SVC_CREATE,
  DIAGNOSTIC_EVENTS.SVC_START_COMMAND,
  DIAGNOSTIC_EVENTS.STATE_MOVING,
  DIAGNOSTIC_EVENTS.STATE_STATIONARY,
  DIAGNOSTIC_EVENTS.AR_SUBSCRIBED,
  DIAGNOSTIC_EVENTS.GEOFENCE_ARMED,
]);

const WATCHDOG_TYPES: ReadonlySet<string> = new Set([
  DIAGNOSTIC_EVENTS.WATCHDOG_FIRE,
  DIAGNOSTIC_EVENTS.WATCHDOG_RESTART,
]);

export function computeInterruptions(
  events: DiagnosticEvent[],
  opts: { intervalMs: number; nowMs: number }
): Interruption[] {
  const threshold = opts.intervalMs * GAP_FACTOR;
  const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs);

  // Watchdog events are the heartbeat anchors for gap detection.
  const watchdogs = sorted.filter((e) => WATCHDOG_TYPES.has(e.eventType));

  // All events by timestamp for cause classification inside a gap.
  const bootTimes = sorted
    .filter((e) => e.eventType === DIAGNOSTIC_EVENTS.BOOT)
    .map((e) => e.timestampMs);

  // Non-watchdog liveness events indicate a manual reopen after a kill.
  const reopenEvents = sorted.filter(
    (e) => LIVENESS_EVENT_TYPES.has(e.eventType) && !WATCHDOG_TYPES.has(e.eventType)
  );

  const out: Interruption[] = [];

  for (let i = 0; i < watchdogs.length - 1; i++) {
    const a = watchdogs[i]!;
    const b = watchdogs[i + 1]!;
    const gap = b.timestampMs - a.timestampMs;
    if (gap <= threshold) continue;

    const bootInGap = bootTimes.some(
      (t) => t > a.timestampMs && t <= b.timestampMs
    );
    const reopenInGap = reopenEvents.some(
      (e) => e.timestampMs > a.timestampMs && e.timestampMs < b.timestampMs
    );

    let cause: InterruptionCause;
    if (bootInGap) cause = 'device_off';
    else if (reopenInGap) cause = 'killed_until_reopen';
    else cause = 'killed_recovered';

    out.push({
      startMs: a.timestampMs,
      endMs: b.timestampMs,
      durationMs: gap,
      cause,
    });
  }

  const last = watchdogs[watchdogs.length - 1];
  if (last && opts.nowMs - last.timestampMs > threshold) {
    out.push({
      startMs: last.timestampMs,
      endMs: opts.nowMs,
      durationMs: opts.nowMs - last.timestampMs,
      cause: 'ongoing',
    });
  }

  return out.sort((x, y) => y.startMs - x.startMs);
}

export async function getInterruptions(
  db: Db,
  opts: { intervalMs: number; nowMs: number; sinceMs?: number }
): Promise<Interruption[]> {
  const events = await listDiagnosticEvents(db, { sinceMs: opts.sinceMs });
  return computeInterruptions(events, { intervalMs: opts.intervalMs, nowMs: opts.nowMs });
}
