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
  const median = medianSpeedMps(s);
  if (median > carThresholdMps) return 'car';
  if (median > bikeThresholdMps) return 'bike';
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
        medianSpeedMps(s) < RULES.VEHICLE_SPEED_SANITY.defaults.minMedianSpeedMps
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

export function medianSpeedMps(s: RawSection): number {
  const speeds: number[] = [];
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]!;
    const b = s.points[i]!;
    const dt = (b.timestampMs - a.timestampMs) / 1000;
    if (dt <= 0) continue;
    const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    speeds.push(d / dt);
  }
  if (speeds.length === 0) return 0;
  speeds.sort((x, y) => x - y);
  return speeds[Math.floor(speeds.length / 2)]!;
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
