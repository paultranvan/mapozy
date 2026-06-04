// Sits between `segmentation()` and `assembleAndPersist()`. Classifies
// each stay as a break (< RULE_TRIP_BREAK_MAX.maxBreakMs) or a trip end
// (≥ that threshold) and groups consecutive trip segments separated by
// breaks into a single multi-leg trip group.
import type { RawPoint } from '../types';
import type { Segment } from './segmentation';
import { RULES } from './rules';

export interface RawBreak {
  startMs: number;
  endMs: number;
  centerLat: number;
  centerLon: number;
  gap: boolean;
}

export interface TripStayBoundary {
  centerLat: number;
  centerLon: number;
  endMs: number;
}

export interface TripLegGroup {
  legs: RawPoint[][];
  breaks: RawBreak[];
  startStay: TripStayBoundary | null;
  endStay: TripStayBoundary | null;
}

export function groupIntoTrips(segments: Segment[]): TripLegGroup[] {
  const maxBreakMs = RULES.TRIP_BREAK_MAX.defaults.maxBreakMs;
  const out: TripLegGroup[] = [];
  let current: TripLegGroup | null = null;
  let previousStay: TripStayBoundary | null = null;

  for (const seg of segments) {
    if (seg.kind === 'trip') {
      if (current === null) {
        current = {
          legs: [seg.points],
          breaks: [],
          startStay: previousStay,
          endStay: null,
        };
        previousStay = null;
      } else {
        current.legs.push(seg.points);
      }
    } else {
      const duration = seg.endMs - seg.startMs;
      const stayBoundary: TripStayBoundary = {
        centerLat: seg.centerLat,
        centerLon: seg.centerLon,
        endMs: seg.endMs,
      };

      if (duration < maxBreakMs) {
        // Short stay: tentative break if we have an open group; always
        // anchor previousStay so the next group still uses it.
        if (current !== null) {
          current.breaks.push({
            startMs: seg.startMs,
            endMs: seg.endMs,
            centerLat: seg.centerLat,
            centerLon: seg.centerLon,
            gap: seg.gap,
          });
        }
        previousStay = stayBoundary;
      } else {
        // Long stay: close any open group, then anchor previousStay.
        if (current !== null) {
          current.endStay = stayBoundary;
          out.push(current);
          current = null;
        }
        previousStay = stayBoundary;
      }
    }
  }

  if (current !== null) {
    // Open-tail: if the last segment was a tentative trailing break, drop
    // it — we have no closing leg to attach it to, and the next pipeline
    // run will reprocess these points.
    if (current.breaks.length === current.legs.length) {
      current.breaks.pop();
    }
    out.push(current);
  }

  return out;
}
