// Rules implemented here (see ./rules.ts):
//   RULE_DWELL_STAY              — sliding-window dwell detection
//   RULE_STALLED_VEHICLE_GUARD   — disqualify dwells overlapping confident in_vehicle
//   RULE_GAP_DWELL               — long tracking gap with non-trivial distance → stay
//   RULE_GAP_PLAUSIBILITY        — overrides RULE_GAP_DWELL when avg gap speed looks like real motion
//   RULE_INFERRED_TRIP_INJECTION — synthetic trip between consecutive stays at different places
import type { RawPoint, RawActivity } from '../types';
import { haversineMeters } from '../lib/distance';
import { RULES } from './rules';

export interface SegOpts {
  dwellMinutes?: number;
  dwellRadiusM?: number;
  gapMinutes?: number;
}

export type Segment =
  | { kind: 'trip'; points: RawPoint[] }
  | {
      kind: 'stay';
      centerLat: number;
      centerLon: number;
      startMs: number;
      endMs: number;
      representativePoint: RawPoint;
    };

// RULE_STALLED_VEHICLE_GUARD
function isStalledVehicle(
  activities: RawActivity[],
  startMs: number,
  endMs: number
): boolean {
  const minConfidence = RULES.STALLED_VEHICLE_GUARD.defaults.minConfidence;
  for (const a of activities) {
    if (
      a.timestampMs >= startMs &&
      a.timestampMs <= endMs &&
      a.type === 'in_vehicle' &&
      a.confidence >= minConfidence
    ) {
      return true;
    }
  }
  return false;
}

export function segmentation(
  points: RawPoint[],
  activities: RawActivity[],
  opts: SegOpts = {}
): Segment[] {
  const dwellMs =
    (opts.dwellMinutes ?? RULES.DWELL_STAY.defaults.dwellMinutes) * 60_000;
  const radius = opts.dwellRadiusM ?? RULES.DWELL_STAY.defaults.dwellRadiusM;
  const gapMs = (opts.gapMinutes ?? RULES.GAP_DWELL.defaults.gapMinutes) * 60_000;
  if (points.length === 0) return [];

  type Window = {
    start: number;
    end: number;
    centerLat: number;
    centerLon: number;
    startIdx: number;
    endIdx: number;
  };
  const dwells: Window[] = [];

  // RULE_DWELL_STAY — slide a same-place window forward until points break out
  // of the radius; if the window spans `dwellMs`+, record a dwell.
  let i = 0;
  while (i < points.length) {
    const anchor = points[i]!;
    let j = i;
    let sumLat = 0;
    let sumLon = 0;
    let count = 0;
    while (j < points.length) {
      const cLat = count === 0 ? anchor.latitude : sumLat / count;
      const cLon = count === 0 ? anchor.longitude : sumLon / count;
      const p = points[j]!;
      if (haversineMeters(p.latitude, p.longitude, cLat, cLon) <= radius) {
        sumLat += p.latitude;
        sumLon += p.longitude;
        count++;
        j++;
      } else {
        break;
      }
    }
    const startMs = anchor.timestampMs;
    const endMs = j > i ? points[j - 1]!.timestampMs : startMs;
    if (
      endMs - startMs >= dwellMs &&
      count >= 2 &&
      !isStalledVehicle(activities, startMs, endMs)
    ) {
      dwells.push({
        start: startMs,
        end: endMs,
        centerLat: sumLat / count,
        centerLon: sumLon / count,
        startIdx: i,
        endIdx: j - 1,
      });
      i = j;
    } else {
      i++;
    }
  }

  // RULE_GAP_DWELL + RULE_GAP_PLAUSIBILITY — turn long tracking gaps into stays,
  // unless the implied avg speed across the gap looks like real travel.
  const gapPlaus = RULES.GAP_PLAUSIBILITY.defaults;
  for (let i = 0; i < points.length - 1; i++) {
    const t1 = points[i]!.timestampMs;
    const t2 = points[i + 1]!.timestampMs;
    const gap = t2 - t1;
    if (gap < gapMs) continue;
    const dist = haversineMeters(
      points[i]!.latitude,
      points[i]!.longitude,
      points[i + 1]!.latitude,
      points[i + 1]!.longitude
    );
    if (dist <= radius) continue;
    if (isStalledVehicle(activities, t1, t2)) continue;

    // RULE_GAP_PLAUSIBILITY: in the soft-to-hard window, if endpoints could
    // plausibly be connected by continuous motion, treat as one trip rather
    // than a stay. Past the hard ceiling, fall through — averages over many
    // hours stop being meaningful.
    const inPlausWindow =
      gap >= gapPlaus.softBreakMs && gap < gapPlaus.hardBreakMs;
    if (inPlausWindow) {
      const avgSpeedMps = dist / (gap / 1000);
      if (avgSpeedMps >= gapPlaus.plausibleSpeedMps) continue;
    }

    dwells.push({
      start: t1,
      end: t2,
      centerLat: points[i]!.latitude,
      centerLon: points[i]!.longitude,
      startIdx: i,
      endIdx: i,
    });
  }

  dwells.sort((a, b) => a.start - b.start);

  const segs: Segment[] = [];
  let cursor = 0;
  for (const d of dwells) {
    if (cursor < d.startIdx) {
      let startIdx = cursor;
      if (cursor > 0) {
        const lastPrev = points[cursor - 1]!;
        const firstTrip = points[cursor]!;
        const dist = haversineMeters(
          lastPrev.latitude,
          lastPrev.longitude,
          firstTrip.latitude,
          firstTrip.longitude
        );
        if (dist <= radius * 3) startIdx = cursor - 1;
      }
      const tripPoints = points.slice(startIdx, d.startIdx + 1);
      if (tripPoints.length >= 2) segs.push({ kind: 'trip', points: tripPoints });
    }
    segs.push({
      kind: 'stay',
      centerLat: d.centerLat,
      centerLon: d.centerLon,
      startMs: d.start,
      endMs: d.end,
      representativePoint: points[d.startIdx]!,
    });
    cursor = d.endIdx + 1;
  }
  if (cursor < points.length) {
    const tail = points.slice(cursor);
    if (tail.length >= 2) segs.push({ kind: 'trip', points: tail });
  }

  return injectInferredTrips(segs, radius);
}

function synthPoint(t: number, lat: number, lon: number): RawPoint {
  return {
    id: 0,
    timestampMs: t,
    latitude: lat,
    longitude: lon,
    altitude: null,
    accuracyMeters: 1,
    speedMps: null,
    bearingDeg: null,
    batteryLevel: null,
    isCharging: false,
    consumed: false,
  };
}

// RULE_INFERRED_TRIP_INJECTION — two stays at different places imply a trip we
// couldn't capture. Borrow a tail slice off the first stay and emit a 2-point
// synthetic trip ending at the next stay.
function injectInferredTrips(segs: Segment[], radius: number): Segment[] {
  const syntheticDurationMs =
    RULES.INFERRED_TRIP_INJECTION.defaults.syntheticTripDurationMs;
  const out: Segment[] = [];
  for (let i = 0; i < segs.length; i++) {
    const cur = segs[i]!;
    const next = i < segs.length - 1 ? segs[i + 1] : null;
    if (cur.kind === 'stay' && next && next.kind === 'stay') {
      const dist = haversineMeters(
        cur.centerLat,
        cur.centerLon,
        next.centerLat,
        next.centerLon
      );
      if (dist > radius) {
        const tripStart = Math.max(
          cur.startMs + 60_000,
          cur.endMs - syntheticDurationMs
        );
        out.push({
          kind: 'stay',
          centerLat: cur.centerLat,
          centerLon: cur.centerLon,
          startMs: cur.startMs,
          endMs: tripStart,
          representativePoint: cur.representativePoint,
        });
        out.push({
          kind: 'trip',
          points: [
            synthPoint(tripStart, cur.centerLat, cur.centerLon),
            synthPoint(next.startMs, next.centerLat, next.centerLon),
          ],
        });
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}
