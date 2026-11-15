import type { Mode, ModeSource, RawPoint } from '../../types';
import type { AerowayWay, RailwayWay, ShoreWay, TransitStop, WaterWay } from '../../lib/overpass';
import { tileReachBBox } from '../../lib/overpass';
import {
  coverageFraction,
  haversineMeters,
  pointToPolylineMeters,
  pointToSegmentMeters,
} from '../../lib/distance';
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
 * RULE_TRAIN_SPEED — classify a motorized section as train from its sustained
 * average speed alone, with no network. Returns null when speed/distance
 * cannot prove rail (the section then goes through geometry matching).
 */
export function classifyTrainBySpeed(
  distanceM: number,
  durationS: number
): TransitClassification | null {
  const { minAvgSpeedMps, minDistanceM } = RULES.TRAIN_SPEED.defaults;
  if (distanceM < minDistanceM) return null;
  if (distanceM / Math.max(1, durationS) < minAvgSpeedMps) return null;
  return { mode: 'train', modeSource: 'speed', modeConfidence: 0.85 };
}

/**
 * Classify one motorized section. Returns null to leave it as `car`.
 * Precedence: rail map-match (geometry, motorway-immune) > rail station at
 * both endpoints. Bus is NOT classified here: a shared route_ref at the
 * endpoints only proves the section's ends sit on one line's corridor — the
 * 2026-07-05 export had five car commutes classified bus this way. Use
 * `sharedEndpointBusRefs` and feed the result to `classifyBusCorridor`,
 * where it counts as a structural vote behind the mandatory dwell evidence.
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

  return null;
}

/**
 * Bus route_refs served by stops at BOTH section endpoints. Structural
 * evidence only (the ends sit on one line's corridor) — never classify on it
 * alone; pass it to `classifyBusCorridor` as `endpointRefs`.
 */
export function sharedEndpointBusRefs(
  startStops: TransitStop[],
  endStops: TransitStop[]
): Set<string> {
  const startRefs = new Set(
    startStops.filter((s) => s.busStop).flatMap(routeRefTokens)
  );
  const out = new Set<string>();
  if (startRefs.size === 0) return out;
  for (const s of endStops) {
    if (!s.busStop) continue;
    for (const r of routeRefTokens(s)) {
      if (startRefs.has(r)) out.add(r);
    }
  }
  return out;
}

/**
 * Cheap local guard for the boat check — evaluated BEFORE any waterway fetch
 * so fast/short sections never cost an Overpass query.
 */
export function boatGuard(distanceM: number, durationS: number): boolean {
  const { maxAvgSpeedMps, minDistanceM } = RULES.WATERWAY_MATCH.defaults;
  return distanceM >= minDistanceM && distanceM / Math.max(1, durationS) <= maxAvgSpeedMps;
}

/**
 * Classify a motorized section as boat when its trace hugs navigable water
 * (RULE_WATERWAY_MATCH). Call only when rail matching came up empty and
 * `boatGuard` passed. Tighter coverage than rail because roads often run
 * within metres of narrow canals.
 */
export function classifyBoat(
  coords: Array<[number, number]>,
  waterways: WaterWay[]
): TransitClassification | null {
  const { coverageMin, bufferM } = RULES.WATERWAY_MATCH.defaults;
  if (waterways.length === 0 || coords.length < 2) return null;
  const cov = coverageFraction(
    coords,
    waterways.map((w) => w.coords),
    bufferM
  );
  if (cov < coverageMin) return null;
  return { mode: 'boat', modeSource: 'watermatch', modeConfidence: Math.min(0.99, cov) };
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
  // Bus refs served at BOTH section endpoints (see sharedEndpointBusRefs) —
  // counts as a structural vote alongside count and span.
  endpointRefs?: Set<string>;
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
    passGapM,
    maxRevisitFrac,
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

  // Stops hugging the trace, with their position along it, whether the trace
  // has a slow moment near them, and how many separate times the trace
  // approaches them (revisit guard — see the rule description).
  const byRef = new Map<string, { pos: number; dwell: boolean; passes: number }[]>();
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
    // Pass counting walks SEGMENTS, not fixes: raw fixes can be hundreds of
    // metres apart, so a revisit leg may sweep right past the stop without a
    // single fix landing inside the radius. Collect the path positions where
    // the trace runs near the stop; positions separated by more than
    // passGapM of travelled path are separate passes (the vehicle left and
    // came back), while dwell jitter at a served stop stays one contiguous
    // stretch. dwellNearM (not stopRadiusM) as the proximity bound: the
    // return leg often runs on the far side of the street, a lane-width
    // beyond the tight stop-matching radius.
    let passes = 0;
    let lastNearPos: number | null = null;
    for (let i = 0; i + 1 < path.length; i++) {
      const d = pointToSegmentMeters([stop.lon, stop.lat], path[i]!, path[i + 1]!);
      if (d > dwellNearM) continue;
      if (lastNearPos === null || cum[i]! - lastNearPos > passGapM) passes++;
      lastNearPos = cum[i]!;
    }
    const entry = { pos: cum[nearestI]!, dwell, passes };
    for (const r of refs) {
      let list = byRef.get(r);
      if (!list) byRef.set(r, (list = []));
      list.push(entry);
    }
  }

  let best:
    | { ref: string; n: number; span: number; dwellFrac: number; revisitFrac: number }
    | null = null;
  for (const [ref, list] of byRef) {
    if (best && list.length <= best.n) continue;
    const pos = list.map((e) => e.pos).sort((a, b) => a - b);
    const span = pos.length > 1 ? (pos[pos.length - 1]! - pos[0]!) / totalM : 0;
    const dwellFrac = list.filter((e) => e.dwell).length / list.length;
    const revisitFrac = list.filter((e) => e.passes >= 2).length / list.length;
    best = { ref, n: list.length, span, dwellFrac, revisitFrac };
  }
  if (!best) return null;
  // Revisit guard: a trace that keeps coming back past the same stops is a
  // vehicle looping through the corridor, not a scheduled service.
  if (best.revisitFrac > maxRevisitFrac) return null;

  // Dwell is MANDATORY: count, span and endpoint refs all just prove the
  // street carries a bus line — any car commuting along the corridor passes
  // them. Only the trace slowing at the stops a bus must serve is behavioral
  // evidence.
  if (best.dwellFrac < minDwellFrac) return null;
  const votes =
    (best.n >= minStops && best.n / (totalM / 1000) >= minDensityPerKm ? 1 : 0) +
    (best.span >= minSpan ? 1 : 0) +
    (input.endpointRefs?.has(best.ref) ? 1 : 0);
  if (votes >= 1) {
    return { mode: 'bus', modeSource: 'corridor', modeConfidence: votes >= 2 ? 0.8 : 0.6 };
  }
  return null;
}

export type ShoreSide = 'sea' | 'land' | 'unknown';

function orient(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

// Does segment p–q cross segment a–b? Half-open on a/b ("on the line" counts
// as one side), so a p–q that passes exactly through a vertex shared by two
// coastline segments is counted once when the coast crosses it and an even
// number of times when the coast only touches it.
function segmentsCross(
  p: [number, number],
  q: [number, number],
  a: [number, number],
  b: [number, number]
): boolean {
  if (orient(p, q, a) > 0 === orient(p, q, b) > 0) return false;
  return orient(a, b, p) > 0 !== orient(a, b, q) > 0;
}

/**
 * Which side of the coast a point is on (RULE_OPEN_WATER). OSM draws
 * coastlines with land on the left and sea on the right, so a spot just right
 * of a coastline segment is known to be sea; the point is on the same side as
 * that spot when the straight line between them crosses the coast an even
 * number of times. The reference segment is taken inside the point's own
 * cache tile, where the tiled fetch loaded every coastline — the count is then
 * exhaustive. 'unknown' when that tile holds no coastline at all (open sea or
 * inland: nothing tells them apart).
 */
export function shoreSide(p: [number, number], coastlines: ShoreWay[]): ShoreSide {
  const reach = tileReachBBox(p[0], p[1]);
  const mLat = 111_320;
  const mLon = mLat * Math.cos((p[1] * Math.PI) / 180);
  let ref: [number, number] | null = null;
  let best = Infinity;
  for (const w of coastlines) {
    for (let i = 1; i < w.coords.length; i++) {
      const a = w.coords[i - 1]!;
      const b = w.coords[i]!;
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (mid[1] < reach.south || mid[1] > reach.north || mid[0] < reach.west || mid[0] > reach.east) {
        continue;
      }
      const dx = (b[0] - a[0]) * mLon;
      const dy = (b[1] - a[1]) * mLat;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const d = Math.hypot((mid[0] - p[0]) * mLon, (mid[1] - p[1]) * mLat);
      if (d >= best) continue;
      best = d;
      // SEA_REF_OFFSET_M to the right of a→b, i.e. on the sea side.
      ref = [
        mid[0] + ((dy / len) * SEA_REF_OFFSET_M) / mLon,
        mid[1] - ((dx / len) * SEA_REF_OFFSET_M) / mLat,
      ];
    }
  }
  if (!ref) return 'unknown';
  let crossings = 0;
  for (const w of coastlines) {
    for (let i = 1; i < w.coords.length; i++) {
      if (segmentsCross(p, ref, w.coords[i - 1]!, w.coords[i]!)) crossings++;
    }
  }
  return crossings % 2 === 0 ? 'sea' : 'land';
}

// How far right of a coastline segment the known-sea reference spot sits.
// Small against any mapped feature, large against the 1e-5° (~1 m) rounding
// of cached way coordinates.
const SEA_REF_OFFSET_M = 3;

export interface OpenWaterStats {
  sea: number; // probe points at sea, clear of the shoreline margin and of any bridge/pier
  land: number; // probe points on land (or on a bridge/pier)
  seaShare: number; // sea / (sea + land); 0 when nothing is known
}

/**
 * Sort a trace's probe points into sea and land. A point at sea only counts
 * once it is `marginM` clear of the coast (GPS jitter along a seafront) and of
 * any bridge or pier (dry ground over water). Points whose tile holds no
 * coastline, and sea points inside the margin, are left out of both tallies.
 */
export function openWaterStats(
  coords: Array<[number, number]>,
  shore: ShoreWay[],
  marginM: number,
  crossingBufferM: number
): OpenWaterStats {
  const coast = shore.filter((w) => w.kind === 'coastline');
  const crossings = shore.filter((w) => w.kind === 'crossing');
  let sea = 0;
  let land = 0;
  for (const c of coords) {
    const side = shoreSide(c, coast);
    if (side === 'unknown') continue;
    if (side === 'land') {
      land++;
      continue;
    }
    if (crossings.some((w) => pointToPolylineMeters(c, w.coords) <= crossingBufferM)) {
      land++;
      continue;
    }
    if (coast.some((w) => pointToPolylineMeters(c, w.coords) < marginM)) continue;
    sea++;
  }
  const known = sea + land;
  return { sea, land, seaShare: known > 0 ? sea / known : 0 };
}

/**
 * RULE_OPEN_WATER — classify a section as boat when most of its probed trace
 * lies at sea. `probe` must be sampled every RULE_OPEN_WATER.probeEveryM (a
 * sparser probe only makes the open-water length floor harder to reach). Call
 * after `boatGuard`.
 */
export function classifyOpenWater(
  probe: Array<[number, number]>,
  shore: ShoreWay[]
): TransitClassification | null {
  const { probeEveryM, marginM, crossingBufferM, minSeaShare, minSeaM } =
    RULES.OPEN_WATER.defaults;
  const st = openWaterStats(probe, shore, marginM, crossingBufferM);
  if (st.sea * probeEveryM < minSeaM || st.seaShare < minSeaShare) return null;
  return { mode: 'boat', modeSource: 'watermatch', modeConfidence: Math.min(0.99, st.seaShare) };
}

/**
 * The longest step between consecutive fixes, when it is at least
 * `minDistanceM` long — the fix-less hop RULE_FLIGHT_AIRPORTS examines.
 */
export function longestHop(
  fixes: RawPoint[],
  minDistanceM: number
): { from: RawPoint; to: RawPoint } | null {
  let best: { from: RawPoint; to: RawPoint } | null = null;
  let bestM = minDistanceM;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1]!;
    const b = fixes[i]!;
    const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    if (d >= bestM) {
      bestM = d;
      best = { from: a, to: b };
    }
  }
  return best;
}

/**
 * RULE_FLIGHT_AIRPORTS — a hop is a flight when both its ends sit on airport
 * ground. Returns null otherwise.
 */
export function classifyAirportHop(
  from: [number, number],
  to: [number, number],
  aeroways: AerowayWay[]
): TransitClassification | null {
  const { airportRadiusM } = RULES.FLIGHT_AIRPORTS.defaults;
  const onAirport = (p: [number, number]) =>
    aeroways.some((w) => pointToPolylineMeters(p, w.coords) <= airportRadiusM);
  if (!onAirport(from) || !onAirport(to)) return null;
  return { mode: 'plane', modeSource: 'station', modeConfidence: 0.8 };
}
