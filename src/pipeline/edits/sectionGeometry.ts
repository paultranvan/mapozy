import type { Mode, Section } from '../../types';
import { pathLengthMeters, haversineMeters } from '../../lib/distance';
import { effectiveMode } from '../effectiveMode';

export function parseCoords(geojson: string): Array<[number, number]> {
  try {
    const g = JSON.parse(geojson) as { coordinates?: Array<[number, number]> };
    return Array.isArray(g.coordinates) ? g.coordinates : [];
  } catch {
    return [];
  }
}

export function coordsToGeojson(coords: Array<[number, number]>): string {
  return JSON.stringify({ type: 'LineString', coordinates: coords });
}

export interface CoordStats {
  distanceM: number;
  durationS: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
}

/**
 * Stats for a polyline spanning [startMs, endMs]. Per-vertex dt is uniform
 * (resample grid), so max speed is the max consecutive-segment speed using that
 * uniform dt.
 */
export function statsFromCoords(
  coords: Array<[number, number]>,
  startMs: number,
  endMs: number
): CoordStats {
  const distanceM = pathLengthMeters(coords);
  const durationS = Math.max(1, Math.round((endMs - startMs) / 1000));
  const avgSpeedMps = distanceM / durationS;
  let maxSpeedMps = 0;
  if (coords.length >= 2) {
    const segDt = durationS / (coords.length - 1);
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1]!;
      const b = coords[i]!;
      const segDist = haversineMeters(a[1], a[0], b[1], b[0]);
      const v = segDt > 0 ? segDist / segDt : 0;
      if (v > maxSpeedMps) maxSpeedMps = v;
    }
  }
  return { distanceM, durationS, avgSpeedMps, maxSpeedMps };
}

function withStats(
  base: Section,
  coords: Array<[number, number]>,
  startMs: number,
  endMs: number,
  mode: Mode,
  userMode: Mode | null
): Section {
  const stats = statsFromCoords(coords, startMs, endMs);
  return {
    ordering: base.ordering,
    startTimeMs: startMs,
    endTimeMs: endMs,
    mode,
    distanceM: stats.distanceM,
    durationS: stats.durationS,
    avgSpeedMps: stats.avgSpeedMps,
    maxSpeedMps: stats.maxSpeedMps,
    co2G: 0, // caller recomputes against effective mode before persisting
    geojson: coordsToGeojson(coords),
    modeSource: 'manual',
    modeConfidence: undefined,
    userMode,
  };
}

/**
 * Split a section at vertex index `k` (1 <= k <= n-2). The cut vertex is shared
 * by both halves so the trace stays continuous. Time is interpolated linearly
 * by vertex fraction. Both halves inherit the original mode + userMode.
 */
export function splitSectionAt(section: Section, k: number): [Section, Section] {
  const coords = parseCoords(section.geojson);
  if (k < 1 || k > coords.length - 2) {
    throw new Error(
      `splitSectionAt: index ${k} out of range for ${coords.length} vertices`
    );
  }
  const span = section.endTimeMs - section.startTimeMs;
  const tCut = Math.round(section.startTimeMs + (span * k) / (coords.length - 1));
  const first = coords.slice(0, k + 1);
  const second = coords.slice(k);
  const mode = section.mode;
  const userMode = section.userMode ?? null;
  return [
    withStats(section, first, section.startTimeMs, tCut, mode, userMode),
    withStats(section, second, tCut, section.endTimeMs, mode, userMode),
  ];
}

/**
 * Merge two adjacent sections into one. Coords concatenated (dropping the
 * duplicate join vertex if present). The merged mode is the longer-distance
 * leg's EFFECTIVE mode, written as the plain `mode` (userMode cleared) with
 * modeSource 'manual'.
 */
export function mergeSectionPair(a: Section, b: Section): Section {
  const ca = parseCoords(a.geojson);
  const cb = parseCoords(b.geojson);
  const joined =
    ca.length > 0 &&
    cb.length > 0 &&
    ca[ca.length - 1]![0] === cb[0]![0] &&
    ca[ca.length - 1]![1] === cb[0]![1]
      ? [...ca, ...cb.slice(1)]
      : [...ca, ...cb];
  const winner = a.distanceM >= b.distanceM ? a : b;
  const mode = effectiveMode(winner);
  return withStats(a, joined, a.startTimeMs, b.endTimeMs, mode, null);
}
