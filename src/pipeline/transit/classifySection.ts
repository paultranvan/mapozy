import type { Mode, ModeSource } from '../../types';
import type { RailwayWay, TransitStop } from '../../lib/overpass';
import { coverageFraction, pointToPolylineMeters } from '../../lib/distance';
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
