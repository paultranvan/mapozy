// Rule implemented here: RULE_DOMINANT_MODE_THRESHOLD (see ./rules.ts).
import type { Trip, Section, DominantMode } from '../types';
import type { RawSection } from './sectionSegmentation';
import { modeForSection, maxSpeedMps } from './modeInference';
import { pathLengthMeters } from '../lib/distance';
import { co2GramsForSection } from '../co2/compute';
import { RULES } from './rules';

export interface AssembleInput {
  rawSections: RawSection[];
  startPlaceId: number | null;
  endPlaceId: number | null;
  nowMs: number;
}

export function assemble(input: AssembleInput): Trip {
  if (input.rawSections.length === 0) {
    throw new Error('assemble: cannot assemble trip with zero sections');
  }

  const sections: Section[] = input.rawSections.map((rs, idx) => {
    const mode = modeForSection(rs);
    const coords = rs.points.map(
      (p) => [p.longitude, p.latitude] as [number, number]
    );
    const distanceM = pathLengthMeters(coords);
    const durationS = Math.max(1, Math.round((rs.endMs - rs.startMs) / 1000));
    const co2G = co2GramsForSection(mode, distanceM);
    return {
      ordering: idx,
      startTimeMs: rs.startMs,
      endTimeMs: rs.endMs,
      mode,
      distanceM,
      durationS,
      avgSpeedMps: distanceM / durationS,
      maxSpeedMps: maxSpeedMps(rs),
      co2G,
      geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
    };
  });

  const distanceM = sections.reduce((s, x) => s + x.distanceM, 0);
  const startMs = input.rawSections[0]!.startMs;
  const endMs = input.rawSections[input.rawSections.length - 1]!.endMs;
  const durationS = Math.max(1, Math.round((endMs - startMs) / 1000));
  const co2G = sections.reduce((s, x) => s + x.co2G, 0);

  const byMode: Record<string, number> = {};
  for (const s of sections) byMode[s.mode] = (byMode[s.mode] ?? 0) + s.distanceM;
  let dominantMode: DominantMode = 'mixed';
  let maxModeDistance = 0;
  for (const [m, d] of Object.entries(byMode)) {
    if (d > maxModeDistance) {
      maxModeDistance = d;
      dominantMode = m as DominantMode;
    }
  }
  // RULE_DOMINANT_MODE_THRESHOLD
  const minShare = RULES.DOMINANT_MODE_THRESHOLD.defaults.dominantModeMinShare;
  if (distanceM > 0 && maxModeDistance / distanceM < minShare) {
    dominantMode = 'mixed';
  }

  const allCoords: Array<[number, number]> = [];
  for (const rs of input.rawSections) {
    for (const p of rs.points) allCoords.push([p.longitude, p.latitude]);
  }

  return {
    startTimeMs: startMs,
    endTimeMs: endMs,
    startPlaceId: input.startPlaceId,
    endPlaceId: input.endPlaceId,
    distanceM,
    durationS,
    dominantMode,
    co2G,
    geojson: JSON.stringify({ type: 'LineString', coordinates: allCoords }),
    manualPurpose: null,
    createdAtMs: input.nowMs,
    sections,
    breaks: [],
  };
}
