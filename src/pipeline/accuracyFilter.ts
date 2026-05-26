// Rule implemented here: RULE_ACCURACY_FILTER (see ./rules.ts).
import type { RawPoint } from '../types';
import { RULES } from './rules';

export interface AccuracyFilterOpts {
  maxAccuracyM?: number;
}

export function accuracyFilter(
  points: RawPoint[],
  opts: AccuracyFilterOpts = {}
): RawPoint[] {
  const max = opts.maxAccuracyM ?? RULES.ACCURACY_FILTER.defaults.maxAccuracyM;
  return points.filter((p) => p.accuracyMeters <= max);
}
