import type { RawPoint } from '../types';

export interface ResampleOpts {
  intervalMs?: number;
}

/**
 * Linear interpolation of (lat, lon, altitude) at fixed-rate timestamps
 * starting from the first point's timestamp up to the last point's
 * timestamp, in `intervalMs` increments.
 */
export function resample(
  points: RawPoint[],
  opts: ResampleOpts = {}
): RawPoint[] {
  const interval = opts.intervalMs ?? 10_000;
  if (points.length < 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const out: RawPoint[] = [];
  for (let t = first.timestampMs; t <= last.timestampMs; t += interval) {
    let j = 0;
    while (j < points.length - 1 && points[j + 1]!.timestampMs <= t) j++;
    const a = points[j]!;
    const b = points[j + 1] ?? a;
    const dt = b.timestampMs - a.timestampMs;
    const f = dt === 0 ? 0 : (t - a.timestampMs) / dt;
    out.push({
      id: a.id,
      timestampMs: t,
      latitude: a.latitude + (b.latitude - a.latitude) * f,
      longitude: a.longitude + (b.longitude - a.longitude) * f,
      altitude:
        a.altitude !== null && b.altitude !== null
          ? a.altitude + (b.altitude - a.altitude) * f
          : a.altitude,
      accuracyMeters: a.accuracyMeters,
      speedMps: a.speedMps,
      bearingDeg: a.bearingDeg,
      batteryLevel: a.batteryLevel,
      isCharging: a.isCharging,
      consumed: a.consumed,
    });
  }
  return out;
}
