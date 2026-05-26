/**
 * Pipeline rule manifest.
 *
 * Every numeric threshold or named heuristic that shapes trip extraction
 * is registered here. Consumer files read their parameters from this
 * manifest and carry a header comment naming the rule id(s) they
 * implement, so each rule is easy to grep, audit, or rip out.
 *
 * To remove a rule:
 *   1. Delete the rule's consuming logic (and update the header comment
 *      in that consumer file).
 *   2. Delete the rule's entry below.
 *
 * Rules are NOT runtime-toggleable on purpose — removal is a code change
 * so the dead branch disappears cleanly.
 *
 * Native-side rules live in
 * `modules/mapozy-tracker/android/src/main/java/expo/modules/mapozytracker/TrackingRules.kt`.
 */

export interface Rule<P> {
  readonly id: string;
  readonly description: string;
  readonly defaults: P;
}

function rule<P>(id: string, description: string, defaults: P): Rule<P> {
  return { id, description, defaults };
}

export const RULES = {
  ACCURACY_FILTER: rule(
    'RULE_ACCURACY_FILTER',
    'Drop GPS points whose reported accuracy is worse than the threshold.',
    { maxAccuracyM: 50 }
  ),

  SPIKE_SMOOTHING: rule(
    'RULE_SPIKE_SMOOTHING',
    'Drop a point whose prev→curr→next path is much longer than direct prev→next (single-point spike).',
    { spikeFactor: 3, minTriangleSideM: 5 }
  ),

  RESAMPLE: rule(
    'RULE_RESAMPLE',
    'Linearly interpolate position at fixed-rate timestamps inside a trip.',
    { intervalMs: 10_000 }
  ),

  DWELL_STAY: rule(
    'RULE_DWELL_STAY',
    'Consecutive points within radius for at least this duration form a stay.',
    { dwellMinutes: 5, dwellRadiusM: 100 }
  ),

  STALLED_VEHICLE_GUARD: rule(
    'RULE_STALLED_VEHICLE_GUARD',
    'A dwell window overlapping a confident in_vehicle activity is a stalled vehicle (traffic), not a stay.',
    { minConfidence: 60 }
  ),

  GAP_DWELL: rule(
    'RULE_GAP_DWELL',
    'A multi-minute tracking gap with non-trivial endpoint distance is treated as a stay at the prior point.',
    { gapMinutes: 10 }
  ),

  GAP_PLAUSIBILITY: rule(
    'RULE_GAP_PLAUSIBILITY',
    'Overrides RULE_GAP_DWELL for 60min+ gaps: if avg speed across the gap is plausible for travel, keep it as one continuous trip (GPS dropout, not a stay). Past a hard ceiling, always fall through to a stay — avg speed loses signal over many hours. The 24h ceiling covers ultra-long-haul flights (SQ23 ~19h, Project Sunrise ~21h) with margin while forcing multi-leg layover trips to split.',
    {
      softBreakMs: 60 * 60_000,
      hardBreakMs: 24 * 60 * 60_000,
      plausibleSpeedMps: 0.5,
    }
  ),

  INFERRED_TRIP_INJECTION: rule(
    'RULE_INFERRED_TRIP_INJECTION',
    'Two consecutive stays at different locations imply a missed trip — synthesize a 2-point trip between them.',
    { syntheticTripDurationMs: 5 * 60_000 }
  ),

  SECTION_ACTIVITY_CONFIDENCE: rule(
    'RULE_SECTION_ACTIVITY_CONFIDENCE',
    'Section segmentation only counts activity events at or above this confidence.',
    { minConfidence: 50 }
  ),

  MIN_SECTION_DURATION: rule(
    'RULE_MIN_SECTION_DURATION',
    'Sections shorter than this duration merge into the previous one (anti-flapping).',
    { minSectionMs: 30_000 }
  ),

  MODE_SPEED_FALLBACK: rule(
    'RULE_MODE_SPEED_FALLBACK',
    'For a section without activity classification, classify mode by median speed.',
    { carThresholdMps: 6.94, bikeThresholdMps: 3.33 }
  ),

  MIN_TRIP_DISTANCE: rule(
    'RULE_MIN_TRIP_DISTANCE',
    'Drop trips with total distance below this threshold.',
    { minTripDistanceM: 100 }
  ),

  DOMINANT_MODE_THRESHOLD: rule(
    'RULE_DOMINANT_MODE_THRESHOLD',
    "A trip whose top-mode distance share falls below this ratio is labeled 'mixed'.",
    { dominantModeMinShare: 0.7 }
  ),
} as const;
