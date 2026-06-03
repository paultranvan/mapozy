// Rules implemented here (see ./rules.ts):
//   RULE_SECTION_ACTIVITY_CONFIDENCE — only count activity events at or above this confidence
//   RULE_MIN_SECTION_DURATION        — merge sub-threshold sections into the previous one
//   RULE_SECTION_ACTIVITY_WINDOW     — time window around the trip for considering activities
//   RULE_WALK_SPEED_BOUNDARY         — move fast tail fixes off a walk section into the next faster one
import type { RawPoint, RawActivity, ActivityType } from '../types';
import { haversineMeters } from '../lib/distance';
import { RULES } from './rules';

const WALK_LIKE: ReadonlySet<ActivityType> = new Set(['walking', 'still', 'unknown']);
const FASTER_THAN_WALK: ReadonlySet<ActivityType> = new Set([
  'in_vehicle',
  'on_bicycle',
  'running',
]);

function stepSpeedMps(a: RawPoint, b: RawPoint): number {
  const dt = (b.timestampMs - a.timestampMs) / 1000;
  if (dt <= 0) return 0;
  return haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude) / dt;
}

/**
 * RULE_WALK_SPEED_BOUNDARY. For each walk-like section directly followed by a
 * faster section, find the first step whose displacement speed is too fast to
 * be on foot and move that point and everything after it into the following
 * section. Corrects the lagging in_vehicle boundary without trusting the
 * activity stream's timing.
 */
function refineWalkVehicleBoundary(sections: RawSection[]): RawSection[] {
  const maxWalkMps = RULES.WALK_SPEED_BOUNDARY.defaults.maxWalkSpeedMps;
  for (let i = 0; i < sections.length - 1; i++) {
    const prev = sections[i]!;
    const next = sections[i + 1]!;
    if (!WALK_LIKE.has(prev.activity) || !FASTER_THAN_WALK.has(next.activity)) continue;

    let onset = -1;
    for (let k = 1; k < prev.points.length; k++) {
      if (stepSpeedMps(prev.points[k - 1]!, prev.points[k]!) > maxWalkMps) {
        onset = k;
        break;
      }
    }
    if (onset < 0) continue;

    const moved = prev.points.splice(onset);
    next.points = [...moved, ...next.points];
    prev.endMs = prev.points[prev.points.length - 1]!.timestampMs;
    next.startMs = next.points[0]!.timestampMs;
  }
  return sections.filter((s) => s.points.length > 0);
}

export interface SectionSegOpts {
  minSectionMs?: number;
  minConfidence?: number;
}

export interface RawSection {
  activity: ActivityType;
  points: RawPoint[];
  startMs: number;
  endMs: number;
}

/**
 * Splits a trip's points into sections where the inferred activity is
 * homogeneous. Sections shorter than `minSectionMs` are merged into the
 * previous one to suppress flapping.
 */
export function sectionSegmentation(
  tripPoints: RawPoint[],
  activities: RawActivity[],
  opts: SectionSegOpts = {}
): RawSection[] {
  const minSection =
    opts.minSectionMs ?? RULES.MIN_SECTION_DURATION.defaults.minSectionMs;
  const minConfidence =
    opts.minConfidence ?? RULES.SECTION_ACTIVITY_CONFIDENCE.defaults.minConfidence;
  if (tripPoints.length === 0) return [];

  // RULE_SECTION_ACTIVITY_WINDOW
  const { startLookbackMs, endLookaheadMs } = RULES.SECTION_ACTIVITY_WINDOW.defaults;
  const tripStart = tripPoints[0]!.timestampMs;
  const tripEnd = tripPoints[tripPoints.length - 1]!.timestampMs;
  const acts = activities
    .filter(
      (a) =>
        a.timestampMs >= tripStart - startLookbackMs &&
        a.timestampMs <= tripEnd + endLookaheadMs
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  // RULE_SECTION_ACTIVITY_CONFIDENCE
  function activityAt(t: number): ActivityType {
    let cur: ActivityType = 'unknown';
    for (const a of acts) {
      if (a.timestampMs > t) break;
      if (a.confidence >= minConfidence) cur = a.type;
    }
    return cur;
  }

  const sections: RawSection[] = [];
  let buffer: RawPoint[] = [];
  let bufferAct: ActivityType = activityAt(tripPoints[0]!.timestampMs);
  for (const p of tripPoints) {
    const a = activityAt(p.timestampMs);
    if (a !== bufferAct && buffer.length > 0) {
      sections.push({
        activity: bufferAct,
        points: buffer,
        startMs: buffer[0]!.timestampMs,
        endMs: buffer[buffer.length - 1]!.timestampMs,
      });
      buffer = [];
      bufferAct = a;
    }
    buffer.push(p);
  }
  if (buffer.length > 0) {
    sections.push({
      activity: bufferAct,
      points: buffer,
      startMs: buffer[0]!.timestampMs,
      endMs: buffer[buffer.length - 1]!.timestampMs,
    });
  }

  if (
    sections.length > 1 &&
    (sections[0]!.activity === 'unknown' ||
      sections[0]!.endMs - sections[0]!.startMs < minSection)
  ) {
    const first = sections.shift()!;
    const next = sections[0]!;
    next.points = [...first.points, ...next.points];
    next.startMs = first.startMs;
  }

  // RULE_MIN_SECTION_DURATION
  const merged: RawSection[] = [];
  for (const s of sections) {
    const dur = s.endMs - s.startMs;
    if (merged.length > 0 && dur < minSection) {
      const prev = merged[merged.length - 1]!;
      prev.points.push(...s.points);
      prev.endMs = s.endMs;
    } else {
      merged.push(s);
    }
  }

  const combined: RawSection[] = [];
  for (const s of merged) {
    const prev = combined[combined.length - 1];
    if (prev && prev.activity === s.activity) {
      prev.points.push(...s.points);
      prev.endMs = s.endMs;
    } else {
      combined.push(s);
    }
  }
  return refineWalkVehicleBoundary(combined);
}
