import type { Section } from '../../types';
import { parseCoords } from './sectionGeometry';
import { haversineMeters } from '../../lib/distance';

export interface SplitLocation {
  sectionId: number;
  vertexIndex: number;
}

/**
 * Nearest INTERIOR vertex (index 1..n-2) to `point` across the given sections.
 * Interior-only guarantees both halves are non-empty. Returns null if no
 * section has an interior vertex (every section has < 3 vertices).
 */
export function locateSplitPoint(
  sections: Section[],
  point: [number, number]
): SplitLocation | null {
  let best: SplitLocation | null = null;
  let bestD = Infinity;
  for (const s of sections) {
    if (s.id == null) continue;
    const coords = parseCoords(s.geojson);
    for (let i = 1; i < coords.length - 1; i++) {
      const c = coords[i]!;
      const d = haversineMeters(point[1], point[0], c[1], c[0]);
      if (d < bestD) {
        bestD = d;
        best = { sectionId: s.id, vertexIndex: i };
      }
    }
  }
  return best;
}
