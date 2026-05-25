import type { RawPoint } from '../types';

export interface AccuracyFilterOpts {
  maxAccuracyM?: number;
}

export function accuracyFilter(
  points: RawPoint[],
  opts: AccuracyFilterOpts = {}
): RawPoint[] {
  const max = opts.maxAccuracyM ?? 50;
  return points.filter((p) => p.accuracyMeters <= max);
}
