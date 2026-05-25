import type { RawPoint } from '../types';
import { haversineMeters } from '../lib/distance';

export interface SmoothingOpts {
  spikeFactor?: number;
  minTriangleSideM?: number;
}

/**
 * Removes single-point spikes. A point is dropped if traveling
 * prev → curr → next is more than `spikeFactor` times the direct
 * prev → next distance.
 */
export function smoothing(
  points: RawPoint[],
  opts: SmoothingOpts = {}
): RawPoint[] {
  const factor = opts.spikeFactor ?? 3;
  const minSide = opts.minTriangleSideM ?? 5;
  if (points.length < 3) return points;
  const out: RawPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const dPrevCurr = haversineMeters(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    );
    const dCurrNext = haversineMeters(
      curr.latitude,
      curr.longitude,
      next.latitude,
      next.longitude
    );
    const dPrevNext = haversineMeters(
      prev.latitude,
      prev.longitude,
      next.latitude,
      next.longitude
    );
    if (dPrevCurr + dCurrNext > factor * Math.max(dPrevNext, minSide)) {
      continue;
    }
    out.push(curr);
  }
  out.push(points[points.length - 1]!);
  return out;
}
