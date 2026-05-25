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
    const trip = assemble({ rawSections, startPlaceId: 1, endPlaceId: 2, nowMs: 100 });
    expect(trip.sections).toHaveLength(1);
    expect(trip.sections[0]!.mode).toBe('walk');
    expect(trip.dominantMode).toBe('walk');
    expect(trip.distanceM).toBeGreaterThan(90);
    expect(trip.distanceM).toBeLessThan(160);
    expect(trip.durationS).toBe(60);
    expect(trip.startPlaceId).toBe(1);
    expect(trip.endPlaceId).toBe(2);
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
      rawSections: [sectionA, sectionB],
      startPlaceId: null,
      endPlaceId: null,
      nowMs: 1000,
    });
    expect(trip.sections).toHaveLength(2);
    // walk ~100m, car ~145m → ratios ~41% / 59% → mixed
    expect(trip.dominantMode).toBe('mixed');
  });
});
