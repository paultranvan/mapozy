// Rule implemented here: RULE_MODE_SPEED_FALLBACK (see ./rules.ts).
// (Mode comes from the activity classifier when known; this rule decides what
// to do when the section's activity is `unknown`.)
import type { Mode } from '../types';
import type { RawSection } from './sectionSegmentation';
import { haversineMeters } from '../lib/distance';
import { RULES } from './rules';

export function modeForSection(s: RawSection): Mode {
  switch (s.activity) {
    case 'in_vehicle':
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
    default: {
      // RULE_MODE_SPEED_FALLBACK
      const { carThresholdMps, bikeThresholdMps } =
        RULES.MODE_SPEED_FALLBACK.defaults;
      const median = medianSpeedMps(s);
      if (median > carThresholdMps) return 'car';
      if (median > bikeThresholdMps) return 'bike';
      return 'walk';
    }
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
