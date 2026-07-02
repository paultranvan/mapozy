import type { Mode, ModeSource } from '../../types';
import type { RailwayWay, TransitStop } from '../../lib/overpass';
import { coverageFraction, haversineMeters, pointToPolylineMeters } from '../../lib/distance';
import { RULES } from '../rules';

export interface TransitClassification {
  mode: Mode;
  modeSource: ModeSource;
  modeConfidence: number;
}

export interface ClassifyInput {
  coords: Array<[number, number]>; // [lon, lat] resampled section points
  ways: RailwayWay[];
  startStops: TransitStop[];
  endStops: TransitStop[];
}

function wayMode(railway: string): Mode {
  switch (railway) {
    case 'subway':
      return 'subway';
    case 'tram':
    case 'light_rail':
      return 'tram';
    default:
      return 'train'; // rail, narrow_gauge
  }
}

function stopRailMode(s: TransitStop): Mode | null {
  if (s.station === 'subway') return 'subway';
  if (s.station === 'light_rail') return 'tram';
  if (s.station === 'tram' || s.railway === 'tram_stop') return 'tram';
  if (s.railway === 'subway_entrance') return 'subway';
  if (s.railway === 'station' || s.railway === 'halt') return 'train';
  return null;
}

// Among the ways the trace actually follows, which railway mode owns the most
// trace points? Decides train vs tram vs subway when several rail types are in
// the bbox (e.g. a tram line running beside heavy rail).
function dominantRailMode(
  coords: Array<[number, number]>,
  ways: RailwayWay[],
  bufferM: number
): Mode | null {
  const tally: Record<string, number> = {};
  for (const c of coords) {
    let best = Infinity;
    let bestWay: RailwayWay | null = null;
    for (const w of ways) {
      const d = pointToPolylineMeters(c, w.coords);
      if (d < best) {
        best = d;
        bestWay = w;
      }
    }
    if (bestWay && best <= bufferM) {
      const m = wayMode(bestWay.railway);
      tally[m] = (tally[m] ?? 0) + 1;
    }
  }
  let top: Mode | null = null;
  let max = 0;
  // Ties broken by first-seen insertion order (rare; any tied rail mode is fine).
  for (const [m, n] of Object.entries(tally)) {
    if (n > max) {
      max = n;
      top = m as Mode;
    }
  }
  return top;
}

function routeRefTokens(s: TransitStop): string[] {
  if (!s.routeRef) return [];
  return s.routeRef
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Classify one motorized section. Returns null to leave it as `car`.
 * Precedence: rail map-match (geometry, motorway-immune) > rail station at both
 * endpoints > bus with a shared route_ref at both endpoints.
 */
export function classifySection(input: ClassifyInput): TransitClassification | null {
  const { coverageMin, bufferM } = RULES.RAIL_MAP_MATCH.defaults;

  // 1. Rail map-match.
  if (input.ways.length > 0 && input.coords.length > 0) {
    const cov = coverageFraction(
      input.coords,
      input.ways.map((w) => w.coords),
      bufferM
    );
    if (cov >= coverageMin) {
      const m = dominantRailMode(input.coords, input.ways, bufferM);
      if (m) {
        return { mode: m, modeSource: 'railmatch', modeConfidence: Math.min(0.99, cov) };
      }
    }
  }

  // 2. Rail station at both endpoints.
  const startModes = new Set(
    input.startStops.map(stopRailMode).filter((m): m is Mode => m !== null)
  );
  const endModes = new Set(
    input.endStops.map(stopRailMode).filter((m): m is Mode => m !== null)
  );
  for (const m of startModes) {
    if (endModes.has(m)) {
      return { mode: m, modeSource: 'station', modeConfidence: 0.7 };
    }
  }

  // 3. Bus: shared route_ref across bus stops at both endpoints.
  const startRefs = new Set(
    input.startStops.filter((s) => s.busStop).flatMap(routeRefTokens)
  );
  if (startRefs.size > 0) {
    const endRefs = input.endStops.filter((s) => s.busStop).flatMap(routeRefTokens);
    if (endRefs.some((r) => startRefs.has(r))) {
      return { mode: 'bus', modeSource: 'station', modeConfidence: 0.6 };
    }
  }

  return null;
}

/**
 * Points along the trace, one every ~everyM metres of cumulative path length
 * (first point included, last appended if the tail is longer than everyM/2).
 * Used to pick which stop-cache cells to load for the corridor check.
 */
export function samplePathEvery(
  coords: Array<[number, number]>,
  everyM: number
): Array<[number, number]> {
  if (coords.length === 0) return [];
  const out: Array<[number, number]> = [coords[0]!];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1]!;
    const [lon1, lat1] = coords[i]!;
    acc += haversineMeters(lat0, lon0, lat1, lon1);
    if (acc >= everyM) {
      out.push(coords[i]!);
      acc = 0;
    }
  }
  if (acc >= everyM / 2 && coords.length > 1) out.push(coords[coords.length - 1]!);
  return out;
}

export interface CorridorInput {
  path: Array<[number, number]>; // raw trace, [lon, lat]
  speeds: Array<number | null>; // speed (m/s) per path point, parallel array
  stops: TransitStop[]; // candidate stops gathered along the path (deduped)
}

/**
 * Door-to-door bus detection (step 4). A door-to-door bus ride has no stop at
 * its endpoints, so endpoint matching misses it. Instead score each bus
 * route_ref by how its stops relate to the trace polyline, on three signals
 * (validated against a tester export, 2026-07-02):
 *   1. count+density — many stops of ONE line hug the trace;
 *   2. span — those stops spread along most of the section;
 *   3. dwell — the trace passes those stops at low speed (a bus SERVES stops,
 *      a car passes them).
 * Any 2 of 3 ⇒ bus. Real rides rarely max all three (power-save GPS thins the
 * dwells; door-to-door legs dilute the span), while an urban car drive along a
 * bus corridor scores at most one.
 */
export function classifyBusCorridor(input: CorridorInput): TransitClassification | null {
  const {
    stopRadiusM,
    minStops,
    minDensityPerKm,
    minSpan,
    minDwellFrac,
    dwellNearM,
    dwellSpeedMps,
  } = RULES.BUS_CORRIDOR.defaults;
  const { path, speeds, stops } = input;
  if (path.length < 2) return null;

  // Cumulative distance along the path, for span computation.
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(
      cum[i - 1]! +
        haversineMeters(path[i - 1]![1], path[i - 1]![0], path[i]![1], path[i]![0])
    );
  }
  const totalM = cum[path.length - 1]!;
  if (totalM <= 0) return null;

  // Stops hugging the trace, with their position along it and whether the
  // trace has a slow moment near them.
  const byRef = new Map<string, { pos: number; dwell: boolean }[]>();
  for (const stop of stops) {
    if (!stop.busStop) continue;
    const refs = routeRefTokens(stop);
    if (refs.length === 0) continue;
    if (pointToPolylineMeters([stop.lon, stop.lat], path) > stopRadiusM) continue;
    let nearestI = 0;
    let nearestD = Infinity;
    let dwell = false;
    for (let i = 0; i < path.length; i++) {
      const d = haversineMeters(path[i]![1], path[i]![0], stop.lat, stop.lon);
      if (d < nearestD) {
        nearestD = d;
        nearestI = i;
      }
      const sp = speeds[i];
      if (!dwell && d <= dwellNearM && sp != null && sp < dwellSpeedMps) dwell = true;
    }
    const entry = { pos: cum[nearestI]!, dwell };
    for (const r of refs) {
      let list = byRef.get(r);
      if (!list) byRef.set(r, (list = []));
      list.push(entry);
    }
  }

  let best: { n: number; span: number; dwellFrac: number } | null = null;
  for (const list of byRef.values()) {
    if (best && list.length <= best.n) continue;
    const pos = list.map((e) => e.pos).sort((a, b) => a - b);
    const span = pos.length > 1 ? (pos[pos.length - 1]! - pos[0]!) / totalM : 0;
    const dwellFrac = list.filter((e) => e.dwell).length / list.length;
    best = { n: list.length, span, dwellFrac };
  }
  if (!best) return null;

  const votes =
    (best.n >= minStops && best.n / (totalM / 1000) >= minDensityPerKm ? 1 : 0) +
    (best.span >= minSpan ? 1 : 0) +
    (best.dwellFrac >= minDwellFrac ? 1 : 0);
  if (votes >= 2) {
    return { mode: 'bus', modeSource: 'corridor', modeConfidence: votes >= 3 ? 0.8 : 0.6 };
  }
  return null;
}
