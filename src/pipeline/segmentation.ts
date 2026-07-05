// Rules implemented here (see ./rules.ts):
//   RULE_DWELL_STAY              — sliding-window dwell detection
//   RULE_STATIONARY_BOUNDARY     — refine trip/stay split inside a detected dwell
//   RULE_STROLL_DWELL_DISCARD    — drop short dwells with no confirmed stillness
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
  stationaryWindowMs?: number;
  stationaryMaxDisplacementM?: number;
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
      gap: boolean;
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
  const stationaryWindowMs =
    opts.stationaryWindowMs ?? RULES.STATIONARY_BOUNDARY.defaults.windowMs;
  const stationaryMaxDispM =
    opts.stationaryMaxDisplacementM ??
    RULES.STATIONARY_BOUNDARY.defaults.maxDisplacementM;
  const stationaryCrawlMps = RULES.STATIONARY_BOUNDARY.defaults.crawlSpeedMps;
  const stallCeilingMs =
    RULES.STALLED_VEHICLE_GUARD.defaults.maxStallMinutes * 60_000;
  const stallMaxSpeedMps = RULES.STALLED_VEHICLE_GUARD.defaults.maxStallSpeedMps;
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
    // RULE_STALLED_VEHICLE_GUARD only vetoes short dwells (a traffic stall lasts
    // minutes); a longer stationary period is a genuine stay no matter what the
    // activity classifier reports.
    const guardApplies = endMs - startMs < stallCeilingMs;
    if (
      endMs - startMs >= dwellMs &&
      count >= 2 &&
      !(guardApplies && isStalledVehicle(activities, startMs, endMs))
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
    // RULE_STALLED_VEHICLE_GUARD ceiling — mirror the dwell path: only a *short*
    // gap with in_vehicle is a moving vehicle that briefly lost signal (tunnel,
    // urban canyon). A multi-hour gap whose endpoints barely moved is a genuine
    // stay; a lone in_vehicle event (often the next trip's departure bleeding
    // into the gap window, or a spurious parked reading) must not veto it.
    // The veto also requires a stall-like implied speed: a real transit hop
    // (e.g. a sub-15-min metro ride that loses GPS underground and reports
    // in_vehicle) covers km at speed and must survive as a gap stay so subway
    // detection can fire — only a near-stationary crawl is a true stall.
    const impliedSpeedMps = dist / (gap / 1000);
    if (
      gap < stallCeilingMs &&
      impliedSpeedMps < stallMaxSpeedMps &&
      isStalledVehicle(activities, t1, t2)
    )
      continue;

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

  // RULE_STATIONARY_BOUNDARY — peel off the approach/departure points at each
  // dwell's edges so they get attributed to the adjacent trips rather than the
  // stay. Gap-based dwells (startIdx === endIdx) are skipped — they're a
  // single representative point with no inner window to refine (and always
  // count as confirmed: the absence of fixes IS the stillness evidence).
  const refined = dwells.map((d) =>
    d.startIdx === d.endIdx
      ? { stayStartIdx: d.startIdx, stayEndIdx: d.endIdx, confirmed: true }
      : refineDwellBoundary(
          points,
          d.startIdx,
          d.endIdx,
          stationaryWindowMs,
          stationaryMaxDispM,
          stationaryCrawlMps,
          radius
        )
  );

  // RULE_STROLL_DWELL_DISCARD — a short dwell with no confirmed stationary
  // moment is slow movement inside the dwell radius (a stroll), not a stay.
  // Drop it so its points flow into the surrounding trip. Long dwells are
  // kept unconditionally (fallback boundaries) — see the rule description.
  const maxUnconfirmedDwellMs =
    RULES.STROLL_DWELL_DISCARD.defaults.maxUnconfirmedDwellMs;
  const keptDwells = dwells
    .map((d, di) => ({ d, r: refined[di]! }))
    .filter(
      ({ d, r }) => r.confirmed || d.end - d.start >= maxUnconfirmedDwellMs
    );

  const segs: Segment[] = [];
  let cursor = 0;
  for (let di = 0; di < keptDwells.length; di++) {
    const { d, r } = keptDwells[di]!;
    const { stayStartIdx, stayEndIdx } = r;
    // A gap dwell is encoded as a single representative point (startIdx ===
    // endIdx); its real time span is the gap [d.start, d.end], not one instant.
    const isGapDwell = d.startIdx === d.endIdx;
    if (cursor < stayStartIdx) {
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
        // Pull the prior stay's last point into this trip so the polyline
        // reaches back to the place — but never across a tracking gap, where
        // the prior point is a stay anchor hours earlier, not an approach fix.
        if (dist <= radius * 3 && firstTrip.timestampMs - lastPrev.timestampMs < gapMs)
          startIdx = cursor - 1;
      }
      const tripPoints = points.slice(startIdx, stayStartIdx + 1);
      if (tripPoints.length >= 2) segs.push({ kind: 'trip', points: tripPoints });
    }
    const stayCenter = computeStayCenter(points, stayStartIdx, stayEndIdx, d);
    segs.push({
      kind: 'stay',
      centerLat: stayCenter.lat,
      centerLon: stayCenter.lon,
      startMs: points[stayStartIdx]!.timestampMs,
      endMs: isGapDwell ? d.end : points[stayEndIdx]!.timestampMs,
      representativePoint: points[stayStartIdx]!,
      gap: isGapDwell,
    });
    cursor = stayEndIdx + 1;
  }
  if (cursor < points.length) {
    const tail = points.slice(cursor);
    if (tail.length >= 2) segs.push({ kind: 'trip', points: tail });
  }

  return injectInferredTrips(segs, radius);
}

// RULE_STATIONARY_BOUNDARY — for the forward search, return true if every
// later point within `windowMs` of `points[idx]` stays within
// `maxDisplacementM` of it. Sparse sampling must not pass vacuously: when the
// first later point already falls past the window (common under power-save,
// where fixes arrive every 70-250s), that point is the only evidence we have
// for the window — so it too must sit close to the reference. Without this,
// a slow walk sampled every 75s reads as "stationary" at every fix and the
// stay swallows the whole final approach, truncating the trip up to ~150m
// short of the destination.
//
// Two closeness bounds apply to that beyond-window point:
//   - the strict `maxDisplacementM` noise bound — over a couple of minutes a
//     stationary phone doesn't drift past it, while a slow stroll does;
//   - failing that, an at-rest drift-speed bound: displacement / silence
//     length at or under `crawlSpeedMps` (and still inside `sameDwellRadiusM`,
//     mirroring RULE_GAP_DWELL's same-place-gap logic). GPS wander across a
//     multi-minute at-rest silence routinely exceeds the strict bound
//     (observed: 28m across a 41-min power-save silence, 16m across a 4-min
//     one), and rejecting it collapses the stay's edge to the last tight fix —
//     shrinking a 55-min stay below RULE_TRIP_BREAK_MAX so two distinct trips
//     merge. The speed form keeps the slow-stroll rejection intact: even the
//     slowest meander drifts at ~0.15 m/s+, while at-rest noise implies a
//     few cm/s.
//
// If the dwell window ends before `windowMs` of data is available, we
// conservatively count the point as stationary only when the remaining-points
// span is at least `windowMs` long — otherwise we can't tell and fall back to
// non-stationary so the dwell anchor wins.
function withinRestBounds(
  d: number,
  silenceMs: number,
  maxDisplacementM: number,
  crawlSpeedMps: number,
  sameDwellRadiusM: number
): boolean {
  if (d <= maxDisplacementM) return true;
  return d <= sameDwellRadiusM && d / (silenceMs / 1000) <= crawlSpeedMps;
}

function isStationaryForward(
  points: RawPoint[],
  idx: number,
  lastIdx: number,
  windowMs: number,
  maxDisplacementM: number,
  crawlSpeedMps: number,
  sameDwellRadiusM: number
): boolean {
  const ref = points[idx]!;
  const t0 = ref.timestampMs;
  for (let k = idx + 1; k <= lastIdx; k++) {
    const p = points[k]!;
    const d = haversineMeters(ref.latitude, ref.longitude, p.latitude, p.longitude);
    if (p.timestampMs - t0 > windowMs) {
      return withinRestBounds(
        d,
        p.timestampMs - t0,
        maxDisplacementM,
        crawlSpeedMps,
        sameDwellRadiusM
      );
    }
    if (d > maxDisplacementM) return false;
  }
  return points[lastIdx]!.timestampMs - t0 >= windowMs;
}

// RULE_STATIONARY_BOUNDARY — mirror of isStationaryForward for the trailing
// edge: every earlier point within `windowMs` of `points[idx]` must stay
// close, including the first point past the window when no fix landed inside
// it (same sparse-sampling + long-silence bounds as the forward search).
function isStationaryBackward(
  points: RawPoint[],
  idx: number,
  firstIdx: number,
  windowMs: number,
  maxDisplacementM: number,
  crawlSpeedMps: number,
  sameDwellRadiusM: number
): boolean {
  const ref = points[idx]!;
  const t0 = ref.timestampMs;
  for (let k = idx - 1; k >= firstIdx; k--) {
    const p = points[k]!;
    const d = haversineMeters(ref.latitude, ref.longitude, p.latitude, p.longitude);
    if (t0 - p.timestampMs > windowMs) {
      return withinRestBounds(
        d,
        t0 - p.timestampMs,
        maxDisplacementM,
        crawlSpeedMps,
        sameDwellRadiusM
      );
    }
    if (d > maxDisplacementM) return false;
  }
  return t0 - points[firstIdx]!.timestampMs >= windowMs;
}

// RULE_STATIONARY_BOUNDARY — given a dwell window [startIdx..endIdx], find
// the tightest inner sub-window where the phone is actually stationary.
// Approach points (entering the dwell circle while still walking) and
// departure points (leaving while still walking) get peeled off so they end
// up in the adjacent trip rather than swallowed by the stay. If no inner
// stationary period can be confirmed, fall back to the original boundaries.
function refineDwellBoundary(
  points: RawPoint[],
  startIdx: number,
  endIdx: number,
  windowMs: number,
  maxDisplacementM: number,
  crawlSpeedMps: number,
  sameDwellRadiusM: number
): { stayStartIdx: number; stayEndIdx: number; confirmed: boolean } {
  let stayStartIdx: number | null = null;
  for (let i = startIdx; i <= endIdx; i++) {
    if (
      isStationaryForward(
        points,
        i,
        endIdx,
        windowMs,
        maxDisplacementM,
        crawlSpeedMps,
        sameDwellRadiusM
      )
    ) {
      stayStartIdx = i;
      break;
    }
  }
  if (stayStartIdx === null) {
    return { stayStartIdx: startIdx, stayEndIdx: endIdx, confirmed: false };
  }

  let stayEndIdx: number | null = null;
  for (let i = endIdx; i >= stayStartIdx; i--) {
    if (
      isStationaryBackward(
        points,
        i,
        stayStartIdx,
        windowMs,
        maxDisplacementM,
        crawlSpeedMps,
        sameDwellRadiusM
      )
    ) {
      stayEndIdx = i;
      break;
    }
  }
  if (stayEndIdx === null) {
    return { stayStartIdx, stayEndIdx: endIdx, confirmed: true };
  }

  return { stayStartIdx, stayEndIdx, confirmed: true };
}

// Recompute the stay's centroid from the refined (stationary-only) subset of
// the dwell points. Falls back to the dwell-wide mean when the refined span
// is degenerate, so place creation still has something sensible to anchor to.
function computeStayCenter(
  points: RawPoint[],
  stayStartIdx: number,
  stayEndIdx: number,
  fallback: { centerLat: number; centerLon: number }
): { lat: number; lon: number } {
  if (stayEndIdx < stayStartIdx) {
    return { lat: fallback.centerLat, lon: fallback.centerLon };
  }
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;
  for (let i = stayStartIdx; i <= stayEndIdx; i++) {
    sumLat += points[i]!.latitude;
    sumLon += points[i]!.longitude;
    count++;
  }
  if (count === 0) return { lat: fallback.centerLat, lon: fallback.centerLon };
  return { lat: sumLat / count, lon: sumLon / count };
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
          gap: cur.gap,
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
