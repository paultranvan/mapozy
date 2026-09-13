import { assemble } from '../assemble';
import type { RawSection } from '../sectionSegmentation';
import { mkPoint, resetIds } from './_fixtures';

describe('assemble', () => {
  beforeEach(() => resetIds());

  it('builds a single-section walk trip with correct distance/duration', () => {
    const pts = [
      mkPoint(0, 0, 0),
      mkPoint(60_000, 0, 0.00127), // ~100m east at equator
    ];
    const rawSections: RawSection[] = [
      { activity: 'walking', points: pts, startMs: 0, endMs: 60_000 },
    ];
    const trip = assemble({
      legs: [{ rawSections }],
      breaks: [],
      startPlaceId: 1,
      endPlaceId: 2,
      nowMs: 100,
    });
    expect(trip.sections).toHaveLength(1);
    expect(trip.sections[0]!.mode).toBe('walk');
    expect(trip.dominantMode).toBe('walk');
    expect(trip.distanceM).toBeGreaterThan(90);
    expect(trip.distanceM).toBeLessThan(160);
    expect(trip.durationS).toBe(60);
    expect(trip.startPlaceId).toBe(1);
    expect(trip.endPlaceId).toBe(2);
  });

  it('respects a pre-set section mode instead of inferring from speed/activity', () => {
    // Slow, short, "walking" points — speed/activity inference would say walk,
    // but a pre-set mode (as flightSplit produces) must win.
    const rawSections: RawSection[] = [
      {
        activity: 'walking',
        points: [mkPoint(0, 0, 0), mkPoint(60_000, 0, 0.00127)],
        startMs: 0,
        endMs: 60_000,
        mode: 'plane',
      },
    ];
    const trip = assemble({
      legs: [{ rawSections }],
      breaks: [],
      startPlaceId: null,
      endPlaceId: null,
      nowMs: 100,
    });
    expect(trip.sections[0]!.mode).toBe('plane');
  });

  it('marks mode "mixed" when no single mode is >= 70% of distance', () => {
    const sectionA: RawSection = {
      activity: 'walking',
      points: [mkPoint(0, 0, 0), mkPoint(60_000, 0, 0.00127)],
      startMs: 0,
      endMs: 60_000,
    };
    const sectionB: RawSection = {
      activity: 'in_vehicle',
      points: [mkPoint(60_000, 0, 0.00127), mkPoint(90_000, 0, 0.0030)],
      startMs: 60_000,
      endMs: 90_000,
    };
    const trip = assemble({
      legs: [{ rawSections: [sectionA, sectionB] }],
      breaks: [],
      startPlaceId: null,
      endPlaceId: null,
      nowMs: 1000,
    });
    expect(trip.sections).toHaveLength(2);
    // walk ~100m, car ~145m → ratios ~41% / 59% → mixed
    expect(trip.dominantMode).toBe('mixed');
  });

  it('builds a 2-leg trip with one break attached at ordering=0', () => {
    const leg1Pts = [mkPoint(0, 0, 0), mkPoint(60_000, 0, 0.00127)];
    const leg2Pts = [mkPoint(720_000, 0, 0.00127), mkPoint(780_000, 0, 0.00254)];
    const sectionA: RawSection = {
      activity: 'walking',
      points: leg1Pts,
      startMs: 0,
      endMs: 60_000,
    };
    const sectionB: RawSection = {
      activity: 'walking',
      points: leg2Pts,
      startMs: 720_000,
      endMs: 780_000,
    };
    const trip = assemble({
      legs: [{ rawSections: [sectionA] }, { rawSections: [sectionB] }],
      breaks: [
        {
          startMs: 60_001,
          endMs: 719_999,
          centerLat: 0,
          centerLon: 0.00127,
          gap: false,
        },
      ],
      startPlaceId: null,
      endPlaceId: null,
      nowMs: 1_000_000,
    });
    expect(trip.sections).toHaveLength(2);
    expect(trip.breaks).toHaveLength(1);
    expect(trip.breaks[0]!.ordering).toBe(0);
    expect(trip.startTimeMs).toBe(0);
    expect(trip.endTimeMs).toBe(780_000);
    // Wall-clock duration includes the break.
    expect(trip.durationS).toBe(780);
  });
});

describe('assemble: consecutive same-mode sections merge', () => {
  beforeEach(() => resetIds());

  it('walking → still → walking (all walk) inside one leg become a single walk section', () => {
    // A 13-min stroll whose activity stream flaps walking/unknown/walking/
    // still/walking came out as five walk legs separated by "transit points"
    // (tester 2026-07-30). Same effective mode, no break between → one leg.
    const mk = (t0: number, n: number, lon0: number) => {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(mkPoint(t0 + i * 15_000, 0, lon0 + 0.0002 * i));
      return pts;
    };
    const a = mk(0, 8, 0);
    const b = mk(8 * 15_000, 4, 0.0016);
    const c = mk(12 * 15_000, 8, 0.0024);
    const rawSections: RawSection[] = [
      { activity: 'walking', points: a, startMs: a[0]!.timestampMs, endMs: a[a.length - 1]!.timestampMs },
      { activity: 'still', points: b, startMs: b[0]!.timestampMs, endMs: b[b.length - 1]!.timestampMs },
      { activity: 'walking', points: c, startMs: c[0]!.timestampMs, endMs: c[c.length - 1]!.timestampMs },
    ];
    const trip = assemble({
      legs: [{ rawSections }],
      breaks: [],
      startPlaceId: 1,
      endPlaceId: 2,
      nowMs: 100,
    });
    expect(trip.sections).toHaveLength(1);
    expect(trip.sections[0]!.mode).toBe('walk');
    expect(trip.sections[0]!.startTimeMs).toBe(a[0]!.timestampMs);
    expect(trip.sections[0]!.endTimeMs).toBe(c[c.length - 1]!.timestampMs);
    expect(JSON.parse(trip.sections[0]!.geojson).coordinates).toHaveLength(20);
  });

  it('does not merge across a break (sections in different legs)', () => {
    const a = [mkPoint(0, 0, 0), mkPoint(60_000, 0, 0.001)];
    const b = [mkPoint(600_000, 0, 0.001), mkPoint(660_000, 0, 0.002)];
    const trip = assemble({
      legs: [
        { rawSections: [{ activity: 'walking', points: a, startMs: 0, endMs: 60_000 }] },
        { rawSections: [{ activity: 'walking', points: b, startMs: 600_000, endMs: 660_000 }] },
      ],
      breaks: [{ startMs: 60_000, endMs: 600_000, centerLat: 0, centerLon: 0.001, gap: false }],
      startPlaceId: 1,
      endPlaceId: 2,
      nowMs: 100,
    });
    expect(trip.sections).toHaveLength(2);
    expect(trip.breaks).toHaveLength(1);
    expect(trip.breaks[0]!.ordering).toBe(0);
  });
});
