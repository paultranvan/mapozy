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
