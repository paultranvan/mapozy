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

  STATIONARY_BOUNDARY: rule(
    'RULE_STATIONARY_BOUNDARY',
    'Inside a detected dwell, refine the trip/stay boundary to the moment the phone is actually stationary (windowed displacement under the threshold), instead of the outer edge of the dwell circle. This makes trip polylines reach the destination instead of being truncated by up to one dwell radius.',
    { windowMs: 60_000, maxDisplacementM: 15 }
  ),

  STALLED_VEHICLE_GUARD: rule(
    'RULE_STALLED_VEHICLE_GUARD',
    'A *short* dwell overlapping a confident in_vehicle activity is a stalled vehicle (traffic), not a stay. The guard only applies below maxStallMinutes: a traffic stall lasts minutes, so a longer stationary period is a genuine stay regardless of activity (which is often a spurious in_vehicle while parked, or an adjacent trip\'s departure event bleeding into the dwell window). This keeps GPS-based stationary detection authoritative over activity recognition for ending trips.',
    { minConfidence: 60, maxStallMinutes: 15 }
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

  SECTION_ACTIVITY_WINDOW: rule(
    'RULE_SECTION_ACTIVITY_WINDOW',
    "Window around a trip in which activity events are considered. The look-back is wide because GPS trip-start lags the activity recogniser's departure event by the time it takes to clear the dwell radius — without it, a drive's opening section loses its in_vehicle label and reads as walk/bike. RULE_VEHICLE_SPEED_SANITY guards against a stale label sticking to a slow section.",
    { startLookbackMs: 4 * 60_000, endLookaheadMs: 60_000 }
  ),

  MODE_SPEED_FALLBACK: rule(
    'RULE_MODE_SPEED_FALLBACK',
    'For a section without activity classification, classify mode by the p75 ' +
      'of device-reported speed_mps (Doppler-derived from satellite signal — a ' +
      'direct velocity reading, not an averaged displacement). Falls back to ' +
      'p75 of haversine-between-consecutive-points when reported speed is missing. ' +
      'p75 (not median) so stop-and-go segments at red lights don\'t pull ' +
      'city driving into the bike range.',
    { carThresholdMps: 6.94, bikeThresholdMps: 3.33 }
  ),

  VEHICLE_SPEED_SANITY: rule(
    'RULE_VEHICLE_SPEED_SANITY',
    'A section the activity classifier labeled in_vehicle but whose p75 speed ' +
      'never reaches vehicle pace is a spurious in_vehicle (e.g. Android reporting ' +
      'in_vehicle while parked). Reclassify it by speed instead of trusting the ' +
      'activity. Skipped when there are too few points to judge speed.',
    { minClassifyingSpeedMps: 2.0 }
  ),

  WALK_SPEED_BOUNDARY: rule(
    'RULE_WALK_SPEED_BOUNDARY',
    'The activity recogniser flags in_vehicle a beat after a drive actually ' +
      'starts, so a walk section preceding a drive absorbs the first fixes of ' +
      'the drive. When a walk-like section is immediately followed by a faster ' +
      "section (in_vehicle / on_bicycle / running), split at the section's " +
      'first step whose displacement speed exceeds a pace no longer plausible ' +
      'on foot, and hand the remaining points to the following section — so the ' +
      'boundary sits where GPS shows movement sped up, not where the lagging ' +
      'activity flipped. A drive that hits a red light right after pulling away ' +
      'still keeps its early fixes (we split at the first fast step, not a ' +
      'sustained run). Upstream accuracy filtering and spike smoothing guard ' +
      'against a lone GPS jump triggering a spurious split.',
    { maxWalkSpeedMps: 2.5 }
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

  TRIP_BREAK_MAX: rule(
    'RULE_TRIP_BREAK_MAX',
    'A stop strictly shorter than this is a break inside the surrounding trip; ' +
      'at or above it, the stop ends the trip. Applied uniformly to all stops ' +
      '(radius-based, gap-based) regardless of place identity.',
    { maxBreakMs: 30 * 60_000 }
  ),
} as const;
