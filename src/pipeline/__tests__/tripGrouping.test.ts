import { groupIntoTrips } from '../tripGrouping';
import type { Segment } from '../segmentation';
import { mkPoint, resetIds } from './_fixtures';

function trip(startMs: number, endMs: number): Segment {
  return {
    kind: 'trip',
    points: [
      mkPoint(startMs, 45.0, 5.0),
      mkPoint(endMs, 45.0, 5.01),
    ],
  };
}

function stay(startMs: number, endMs: number, lat = 45.0, lon = 5.0): Segment {
  return {
    kind: 'stay',
    centerLat: lat,
    centerLon: lon,
    startMs,
    endMs,
    representativePoint: mkPoint(startMs, lat, lon),
    gap: false,
  };
}

describe('groupIntoTrips', () => {
  beforeEach(() => resetIds());

  it('returns an empty list when given no segments', () => {
    expect(groupIntoTrips([])).toEqual([]);
  });

  it('emits a single closed group for stay → trip → stay (both stays long)', () => {
    const segs: Segment[] = [
      stay(0, 60 * 60_000),                   // 1h stay
      trip(60 * 60_000 + 1000, 70 * 60_000),  // 10 min trip
      stay(70 * 60_000 + 1000, 130 * 60_000), // 1h stay
    ];
    const groups = groupIntoTrips(segs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.legs).toHaveLength(1);
    expect(groups[0]!.breaks).toEqual([]);
    expect(groups[0]!.startStay).not.toBeNull();
    expect(groups[0]!.endStay).not.toBeNull();
  });

  it('folds a short mid stay into the current group as a break (one 2-leg group)', () => {
    // long-stay → trip1 → short-stay (10 min) → trip2 → long-stay
    const segs: Segment[] = [
      stay(0, 60 * 60_000),
      trip(60 * 60_000 + 1000, 70 * 60_000),
      stay(70 * 60_000 + 1000, 80 * 60_000),    // 10 min — break
      trip(80 * 60_000 + 1000, 90 * 60_000),
      stay(90 * 60_000 + 1000, 150 * 60_000),
    ];
    const groups = groupIntoTrips(segs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.legs).toHaveLength(2);
    expect(groups[0]!.breaks).toHaveLength(1);
    // stay(70*60_000 + 1000, 80*60_000) → duration = 10*60_000 - 1000
    expect(groups[0]!.breaks[0]!.endMs - groups[0]!.breaks[0]!.startMs)
      .toBe(10 * 60_000 - 1000);
  });

  it('splits into two groups when the mid stay is ≥ 30 min', () => {
    const segs: Segment[] = [
      stay(0, 60 * 60_000),
      trip(60 * 60_000 + 1000, 70 * 60_000),
      stay(70 * 60_000 + 1000, 100 * 60_000 + 1000), // 30 min — trip end
      trip(100 * 60_000 + 2000, 110 * 60_000),
      stay(110 * 60_000 + 1000, 170 * 60_000),
    ];
    const groups = groupIntoTrips(segs);
    expect(groups).toHaveLength(2);
    groups.forEach((g) => {
      expect(g.legs).toHaveLength(1);
      expect(g.breaks).toEqual([]);
    });
  });

  it('handles three legs with two breaks', () => {
    const segs: Segment[] = [
      stay(0, 60 * 60_000),
      trip(60 * 60_000 + 1000, 70 * 60_000),
      stay(70 * 60_000 + 1000, 76 * 60_000),  // 6 min — break
      trip(76 * 60_000 + 1000, 80 * 60_000),
      stay(80 * 60_000 + 1000, 87 * 60_000),  // 7 min — break
      trip(87 * 60_000 + 1000, 95 * 60_000),
      stay(95 * 60_000 + 1000, 155 * 60_000),
    ];
    const groups = groupIntoTrips(segs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.legs).toHaveLength(3);
    expect(groups[0]!.breaks).toHaveLength(2);
  });

  it('open tail: trip with no closing stay leaves endStay null', () => {
    const segs: Segment[] = [
      stay(0, 60 * 60_000),
      trip(60 * 60_000 + 1000, 70 * 60_000),
    ];
    const groups = groupIntoTrips(segs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.endStay).toBeNull();
    expect(groups[0]!.legs).toHaveLength(1);
  });

  it('open tail with a trailing short stay: drops the tentative break, leaves endStay null', () => {
    const segs: Segment[] = [
      stay(0, 60 * 60_000),
      trip(60 * 60_000 + 1000, 70 * 60_000),
      stay(70 * 60_000 + 1000, 76 * 60_000),  // 6 min trailing — undecided
    ];
    const groups = groupIntoTrips(segs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.legs).toHaveLength(1);
    expect(groups[0]!.breaks).toEqual([]);
    expect(groups[0]!.endStay).toBeNull();
  });

  it('leading short stay anchors the next group as startStay', () => {
    const segs: Segment[] = [
      stay(0, 6 * 60_000, 45.1, 5.1),                     // 6 min leading
      trip(6 * 60_000 + 1000, 16 * 60_000),
      stay(16 * 60_000 + 1000, 76 * 60_000),
    ];
    const groups = groupIntoTrips(segs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.startStay).not.toBeNull();
    expect(groups[0]!.startStay!.centerLat).toBe(45.1);
  });
});
