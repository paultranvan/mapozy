// RULE_DOMINANT_MODE_THRESHOLD (see ./rules.ts).
import type { DominantMode } from '../types';
import { RULES } from './rules';

/**
 * The trip's dominant mode is the mode covering the most distance, unless that
 * top mode's distance share is below the threshold — then the trip is 'mixed'.
 */
export function dominantModeFor(
  sections: Array<{ mode: string; distanceM: number }>
): DominantMode {
  const byMode: Record<string, number> = {};
  let total = 0;
  for (const s of sections) {
    byMode[s.mode] = (byMode[s.mode] ?? 0) + s.distanceM;
    total += s.distanceM;
  }
  let dom: DominantMode = 'mixed';
  let max = 0;
  for (const [m, d] of Object.entries(byMode)) {
    if (d > max) {
      max = d;
      dom = m as DominantMode;
    }
  }
  const minShare = RULES.DOMINANT_MODE_THRESHOLD.defaults.dominantModeMinShare;
  if (total > 0 && max / total < minShare) dom = 'mixed';
  return dom;
}
