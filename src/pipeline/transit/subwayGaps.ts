import type { Section, TripBreak, DominantMode, Mode } from '../../types';
import type { TransitStop } from '../../lib/overpass';
import { haversineMeters, pathLengthMeters } from '../../lib/distance';
import { co2GramsForSection } from '../../co2/compute';
import { dominantModeFor } from '../dominantMode';
import { RULES } from '../rules';

export function isMetroStation(s: TransitStop): boolean {
  if (s.station === 'subway') return true;
  if (s.railway === 'subway_entrance') return true;
  return false;
}

// A gap-derived break is a subway candidate when it's the right length and its
// endpoints are far enough apart to be travel rather than a pause.
export function qualifiesAsSubwayGap(
  b: TripBreak,
  entry: [number, number],
  exit: [number, number]
): boolean {
  if (!b.gap) return false;
  const { minMinutes, maxMinutes, minDistanceM } = RULES.SUBWAY_GAP.defaults;
  const minutes = (b.endTimeMs - b.startTimeMs) / 60_000;
  if (minutes < minMinutes || minutes > maxMinutes) return false;
  const dist = haversineMeters(entry[1], entry[0], exit[1], exit[0]);
  return dist >= minDistanceM;
}

export function buildSubwaySection(
  b: TripBreak,
  entry: [number, number],
  exit: [number, number]
): Section {
  const coords: Array<[number, number]> = [entry, exit];
  const distanceM = pathLengthMeters(coords);
  const durationS = Math.max(1, Math.round((b.endTimeMs - b.startTimeMs) / 1000));
  return {
    ordering: 0, // reassigned by rebuildWithSubway
    startTimeMs: b.startTimeMs,
    endTimeMs: b.endTimeMs,
    mode: 'subway',
    distanceM,
    durationS,
    avgSpeedMps: distanceM / durationS,
    // 2-point stub: max == avg (no intra-section samples to compute a real max).
    maxSpeedMps: distanceM / durationS,
    co2G: co2GramsForSection('subway', distanceM),
    geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
    modeSource: 'gap',
    modeConfidence: 0.7,
  };
}

// Merge sections + breaks into one ordered stream, replacing each converted
// break (keyed by its original, pre-rebuild ordering) with its subway section,
// and renumber.
export function rebuildWithSubway(
  sections: Section[],
  breaks: TripBreak[],
  conversions: Map<number, Section>
): { sections: Section[]; breaks: TripBreak[] } {
  const breaksByOrder = new Map<number, TripBreak>();
  for (const b of breaks) breaksByOrder.set(b.ordering, b);

  const outSections: Section[] = [];
  const outBreaks: TripBreak[] = [];
  for (let i = 0; i < sections.length; i++) {
    outSections.push({ ...sections[i]!, ordering: outSections.length });
    const b = breaksByOrder.get(i);
    if (!b) continue;
    const conv = conversions.get(i);
    if (conv) {
      outSections.push({ ...conv, ordering: outSections.length });
    } else {
      outBreaks.push({ ...b, ordering: outSections.length - 1 });
    }
  }
  return { sections: outSections, breaks: outBreaks };
}

export interface TripTotals {
  distanceM: number;
  co2G: number;
  dominantMode: DominantMode;
  geojson: string;
}

export function recomputeTotals(sections: Section[]): TripTotals {
  const distanceM = sections.reduce((a, s) => a + s.distanceM, 0);
  const co2G = sections.reduce((a, s) => a + s.co2G, 0);
  const dominantMode = dominantModeFor(sections);
  const allCoords: Array<[number, number]> = [];
  for (const s of sections) {
    try {
      const g = JSON.parse(s.geojson) as { coordinates?: Array<[number, number]> };
      if (Array.isArray(g.coordinates)) allCoords.push(...g.coordinates);
    } catch {
      // skip unparseable section geometry
    }
  }
  return {
    distanceM,
    co2G,
    dominantMode,
    geojson: JSON.stringify({ type: 'LineString', coordinates: allCoords }),
  };
}

const RAIL_MODES: ReadonlySet<Mode> = new Set(['subway', 'train', 'tram']);

// A gap stay (RULE_GAP_DWELL: no fixes, endpoints far apart) followed by the
// synthetic leg RULE_INFERRED_TRIP_INJECTION cuts out of its tail is ONE
// untracked ride: the "stay" at the pre-gap point is a fiction, the leg's
// 5-min duration too. When enrichment recognises that leg as rail (station
// endpoints / rail geometry), fold the gap break into it so the ride spans the
// whole silence — instead of "Break · 23 min" followed by "Subway · 5 min ·
// 99 km/h" (tester export 2026-08-02, trip of 16 Jul). The pair is recognised
// by construction: the injected leg starts exactly where the shortened stay
// ends.
export function absorbGapBreaksIntoRailLegs(
  sections: Section[],
  breaks: TripBreak[]
): { sections: Section[]; breaks: TripBreak[]; changed: boolean } {
  const outSections = sections.map((s) => ({ ...s }));
  const outBreaks: TripBreak[] = [];
  let changed = false;
  for (const b of breaks) {
    const after = outSections[b.ordering + 1];
    if (
      b.gap &&
      after &&
      after.startTimeMs === b.endTimeMs &&
      RAIL_MODES.has(after.mode)
    ) {
      after.startTimeMs = b.startTimeMs;
      after.durationS = Math.max(1, Math.round((after.endTimeMs - after.startTimeMs) / 1000));
      after.avgSpeedMps = after.distanceM / after.durationS;
      after.maxSpeedMps = Math.min(after.maxSpeedMps, Math.max(after.avgSpeedMps, after.maxSpeedMps));
      // A 2-point stub reports max == old avg; scale it down with the new pace.
      if (after.maxSpeedMps > after.avgSpeedMps * 3) after.maxSpeedMps = after.avgSpeedMps;
      changed = true;
    } else {
      outBreaks.push({ ...b });
    }
  }
  return { sections: outSections, breaks: outBreaks, changed };
}
