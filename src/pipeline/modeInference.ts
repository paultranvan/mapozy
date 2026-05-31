// Rules implemented here (see ./rules.ts):
//   RULE_MODE_SPEED_FALLBACK   — classify by speed when activity is `unknown`
//   RULE_VEHICLE_SPEED_SANITY  — distrust an in_vehicle label on a stationary section
import type { Mode } from '../types';
import type { RawSection } from './sectionSegmentation';
import { haversineMeters } from '../lib/distance';
import { RULES } from './rules';

// RULE_MODE_SPEED_FALLBACK
function classifyBySpeed(s: RawSection): Mode {
  const { carThresholdMps, bikeThresholdMps } = RULES.MODE_SPEED_FALLBACK.defaults;
  const v = classifyingSpeedMps(s);
  if (v > carThresholdMps) return 'car';
  if (v > bikeThresholdMps) return 'bike';
  return 'walk';
}

export function modeForSection(s: RawSection): Mode {
  switch (s.activity) {
    case 'in_vehicle':
      // RULE_VEHICLE_SPEED_SANITY: an in_vehicle section that never reaches
      // vehicle pace is a spurious classification (e.g. parked). Trust the
      // measured speed over the activity when we have points to judge it.
      if (
        s.points.length >= 2 &&
        classifyingSpeedMps(s) < RULES.VEHICLE_SPEED_SANITY.defaults.minClassifyingSpeedMps
      ) {
        return classifyBySpeed(s);
      }
      return 'car';
    case 'on_bicycle':
      return 'bike';
    case 'running':
      return 'run';
    case 'walking':
      return 'walk';
    case 'still':
      return 'walk';
    case 'unknown':
    default:
      return classifyBySpeed(s);
  }
}

/**
 * Representative speed used by RULE_MODE_SPEED_FALLBACK and
 * RULE_VEHICLE_SPEED_SANITY. p75 of device-reported `speed_mps` (Doppler-
 * derived from satellite signal — a direct, near-instantaneous measure),
 * with p75 of haversine-between-consecutive-points as fallback when the
 * GPS chip didn't report speed.
 *
 * Why reported over haversine: haversine averages displacement over each
 * segment, so stops within a segment (red lights, traffic) drag the
 * value down. Doppler speed is the chip's actual velocity reading at the
 * fix moment and isn't biased by the *gaps between fixes*.
 *
 * Why p75 over median: with reported speed, half the samples in a city
 * drive can be stop-and-go (0-3 m/s) — the median lands in the bike
 * range even when the trip is unambiguously a car. p75 reflects how fast
 * the user moves *when actually moving*, which is what mode classification
 * needs.
 */
export function classifyingSpeedMps(s: RawSection): number {
  const reported = s.points
    .map((p) => p.speedMps)
    .filter((v): v is number => v != null);
  if (reported.length >= 2) {
    reported.sort((a, b) => a - b);
    return reported[Math.floor(0.75 * reported.length)]!;
  }
  const segs: number[] = [];
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]!;
    const b = s.points[i]!;
    const dt = (b.timestampMs - a.timestampMs) / 1000;
    if (dt <= 0) continue;
    const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    segs.push(d / dt);
  }
  if (segs.length === 0) return 0;
  segs.sort((x, y) => x - y);
  return segs[Math.floor(0.75 * segs.length)]!;
}

export function maxSpeedMps(s: RawSection): number {
  let max = 0;
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]!;
    const b = s.points[i]!;
    const dt = (b.timestampMs - a.timestampMs) / 1000;
    if (dt <= 0) continue;
    const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    if (d / dt > max) max = d / dt;
  }
  return max;
}

export function avgSpeedMps(s: RawSection): number {
  if (s.points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]!;
    const b = s.points[i]!;
    total += haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  }
  const dur = (s.endMs - s.startMs) / 1000;
  return dur > 0 ? total / dur : 0;
}
