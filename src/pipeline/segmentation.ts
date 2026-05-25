import type { RawPoint, RawActivity } from '../types';
import { haversineMeters } from '../lib/distance';

export interface SegOpts {
  dwellMinutes?: number;
  dwellRadiusM?: number;
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

/**
 * Walks through points chronologically and identifies dwell windows
 * (consecutive points staying within `dwellRadiusM` for at least
 * `dwellMinutes`). Returns segments interleaving 'trip' (movement)
 * and 'stay' (dwell).
 */
export function segmentation(
  points: RawPoint[],
  _activities: RawActivity[],
  opts: SegOpts = {}
): Segment[] {
  const dwellMs = (opts.dwellMinutes ?? 5) * 60_000;
  const radius = opts.dwellRadiusM ?? 100;
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
    if (endMs - startMs >= dwellMs && count >= 2) {
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

  const segs: Segment[] = [];
  let cursor = 0;
  for (const d of dwells) {
    if (cursor < d.startIdx) {
      // Trip from cursor up to and including the first stay point as endpoint
      const tripPoints = points.slice(cursor, d.startIdx + 1);
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
  return segs;
}
