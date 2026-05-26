import type { RawPoint, RawActivity, ActivityType } from '../types';

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
  const minSection = opts.minSectionMs ?? 30_000;
  const minConfidence = opts.minConfidence ?? 50;
  if (tripPoints.length === 0) return [];

  const tripStart = tripPoints[0]!.timestampMs;
  const tripEnd = tripPoints[tripPoints.length - 1]!.timestampMs;
  const acts = activities
    .filter(
      (a) => a.timestampMs >= tripStart - 60_000 && a.timestampMs <= tripEnd + 60_000
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

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
  return combined;
}
