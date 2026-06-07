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
  // A short stay only becomes a committed break once a *following* leg
  // arrives — a break is meaningful only between two legs. Segmentation can
  // emit consecutive stays (e.g. a regular stay immediately followed by a gap
  // stay), which would otherwise yield more breaks than leg-gaps and break the
  // `breaks === legs - 1` invariant in assemble(). Consecutive stays merge
  // into this single pending break; it is dropped if the group closes (long
  // stay or end-of-stream) before another leg appears.
  let pendingBreak: RawBreak | null = null;

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
        if (pendingBreak !== null) current.breaks.push(pendingBreak);
        current.legs.push(seg.points);
      }
      pendingBreak = null;
    } else {
      const duration = seg.endMs - seg.startMs;
      const stayBoundary: TripStayBoundary = {
        centerLat: seg.centerLat,
        centerLon: seg.centerLon,
        endMs: seg.endMs,
      };

      if (duration < maxBreakMs) {
        // Short stay: hold as a pending break until a closing leg appears.
        // Always anchor previousStay so the next group still uses it.
        if (current !== null) {
          if (pendingBreak === null) {
            pendingBreak = {
              startMs: seg.startMs,
              endMs: seg.endMs,
              centerLat: seg.centerLat,
              centerLon: seg.centerLon,
              gap: seg.gap,
            };
          } else {
            // Consecutive stays with no intervening leg: extend the span and
            // keep the gap flag if any component was a GPS dropout (so subway
            // gap detection still fires).
            pendingBreak.endMs = seg.endMs;
            pendingBreak.gap = pendingBreak.gap || seg.gap;
          }
        }
        previousStay = stayBoundary;
      } else {
        // Long stay: close any open group, then anchor previousStay. A
        // pending break with no closing leg is dropped.
        pendingBreak = null;
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
    // Open-tail: a trailing pending break never got a closing leg, so it was
    // never committed — the next pipeline run reprocesses these points.
    out.push(current);
  }

  return out;
}
