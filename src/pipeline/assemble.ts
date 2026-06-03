// Rules implemented here: RULE_DOMINANT_MODE_THRESHOLD (see ./rules.ts).
import type { Trip, Section, TripBreak, DominantMode } from '../types';
import type { RawSection } from './sectionSegmentation';
import type { RawBreak } from './tripGrouping';
import { modeForSection, maxSpeedMps } from './modeInference';
import { pathLengthMeters } from '../lib/distance';
import { co2GramsForSection } from '../co2/compute';
import { RULES } from './rules';

export interface AssembleLeg {
  rawSections: RawSection[];
}

export interface AssembleInput {
  legs: AssembleLeg[];
  breaks: RawBreak[];
  startPlaceId: number | null;
  endPlaceId: number | null;
  nowMs: number;
}

export function assemble(input: AssembleInput): Trip {
  if (input.legs.length === 0) {
    throw new Error('assemble: cannot assemble trip with zero legs');
  }
  if (input.breaks.length !== input.legs.length - 1) {
    throw new Error(
      `assemble: expected ${input.legs.length - 1} breaks, got ${input.breaks.length}`
    );
  }

  // Flatten per-leg sections into one ordered list. Each section gets a
  // globally-incrementing `ordering`. Breaks slot in based on the last
  // section index emitted by the leg that precedes them.
  const sections: Section[] = [];
  const breakOrderings: number[] = [];
  for (let li = 0; li < input.legs.length; li++) {
    const leg = input.legs[li]!;
    if (leg.rawSections.length === 0) {
      throw new Error(`assemble: leg ${li} has zero sections`);
    }
    for (const rs of leg.rawSections) {
      const mode = modeForSection(rs);
      const coords = rs.points.map(
        (p) => [p.longitude, p.latitude] as [number, number]
      );
      const distanceM = pathLengthMeters(coords);
      const durationS = Math.max(1, Math.round((rs.endMs - rs.startMs) / 1000));
      const co2G = co2GramsForSection(mode, distanceM);
      sections.push({
        ordering: sections.length,
        startTimeMs: rs.startMs,
        endTimeMs: rs.endMs,
        mode,
        distanceM,
        durationS,
        avgSpeedMps: distanceM / durationS,
        maxSpeedMps: maxSpeedMps(rs),
        co2G,
        geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
      });
    }
    if (li < input.legs.length - 1) {
      breakOrderings.push(sections.length - 1);
    }
  }

  const breaks: TripBreak[] = input.breaks.map((b, i) => ({
    ordering: breakOrderings[i]!,
    startTimeMs: b.startMs,
    endTimeMs: b.endMs,
    centerLat: b.centerLat,
    centerLon: b.centerLon,
  }));

  const distanceM = sections.reduce((s, x) => s + x.distanceM, 0);
  const startMs = sections[0]!.startTimeMs;
  const endMs = sections[sections.length - 1]!.endTimeMs;
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

  // Single concatenated LineString across all legs — break points have
  // zero extent on the map, matching how the user actually moved.
  const allCoords: Array<[number, number]> = [];
  for (const leg of input.legs) {
    for (const rs of leg.rawSections) {
      for (const p of rs.points) allCoords.push([p.longitude, p.latitude]);
    }
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
    draft: false,
    draftReason: null,
    createdAtMs: input.nowMs,
    sections,
    breaks,
  };
}
