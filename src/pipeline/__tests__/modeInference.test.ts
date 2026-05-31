import { modeForSection } from '../modeInference';
import type { RawSection } from '../sectionSegmentation';
import { mkPoint, resetIds } from './_fixtures';

function mkSection(activity: RawSection['activity'], pts: RawSection['points']): RawSection {
  return {
    activity,
    points: pts,
    startMs: pts[0]?.timestampMs ?? 0,
    endMs: pts[pts.length - 1]?.timestampMs ?? 0,
  };
}

describe('modeInference', () => {
  beforeEach(() => resetIds());

  it('in_vehicle → car', () => {
    expect(modeForSection(mkSection('in_vehicle', []))).toBe('car');
  });
  it('on_bicycle → bike', () => {
    expect(modeForSection(mkSection('on_bicycle', []))).toBe('bike');
  });
  it('running → run', () => {
    expect(modeForSection(mkSection('running', []))).toBe('run');
  });
  it('walking → walk', () => {
    expect(modeForSection(mkSection('walking', []))).toBe('walk');
  });

  it('in_vehicle but stationary (no vehicle-speed movement) → walk', () => {
    // Android sometimes reports in_vehicle while parked/stationary. A section
    // that never reaches vehicle pace is not a drive (RULE_VEHICLE_SPEED_SANITY).
    const pts = [mkPoint(0, 0, 0), mkPoint(60_000, 0, 0)]; // 0 movement over 60s
    expect(modeForSection(mkSection('in_vehicle', pts))).toBe('walk');
  });

  it('in_vehicle with real vehicle speed → car', () => {
    // ~111m in 5s = 22 m/s (80 km/h) → clearly driving
    const pts = [mkPoint(0, 0, 0), mkPoint(5000, 0, 0.001)];
    expect(modeForSection(mkSection('in_vehicle', pts))).toBe('car');
  });

  describe('unknown activity (haversine fallback when speedMps null)', () => {
    // At equator, 0.001 deg longitude ≈ 111.2 m. Tune (delta, dt) to land
    // squarely in each speed bracket.
    it('high speed → car', () => {
      // ~111m in 5s = 22.24 m/s (80 km/h) → car (> 6.94 m/s)
      const pts = [mkPoint(0, 0, 0), mkPoint(5000, 0, 0.001)];
      expect(modeForSection(mkSection('unknown', pts))).toBe('car');
    });
    it('medium speed → bike', () => {
      // ~111m in 25s = 4.44 m/s (16 km/h) → bike (between 3.33 and 6.94)
      const pts = [mkPoint(0, 0, 0), mkPoint(25_000, 0, 0.001)];
      expect(modeForSection(mkSection('unknown', pts))).toBe('bike');
    });
    it('low speed → walk', () => {
      // ~111m in 90s = 1.23 m/s (4.4 km/h) → walk
      const pts = [mkPoint(0, 0, 0), mkPoint(90_000, 0, 0.001)];
      expect(modeForSection(mkSection('unknown', pts))).toBe('walk');
    });
  });

  describe('unknown activity (reported speed_mps available)', () => {
    function withSpeed(t: number, mps: number) {
      // Position is irrelevant: reported speedMps wins over haversine when we
      // have ≥ 2 reported values.
      return mkPoint(t, 0, 0, 5, mps);
    }
    it('p75 well above car threshold → car', () => {
      // p75 of [2, 8, 10, 12] (n=4, floor(0.75*4)=3) = 12 → car
      const pts = [
        withSpeed(0, 2),
        withSpeed(10_000, 8),
        withSpeed(20_000, 10),
        withSpeed(30_000, 12),
      ];
      expect(modeForSection(mkSection('unknown', pts))).toBe('car');
    });

    it('city drive with lots of red lights → still car via p75', () => {
      // Trip 18 reproducer: many slow values + a few fast. Median would land
      // in the bike range (the original bug), but p75 lifts it back to car.
      const speeds = [
        0.0, 0.22, 1.39, 2.23, 2.7, 4.37, 4.6, 5.54, 6.1, 6.58, 6.77, 7.47,
        7.74, 7.86, 7.98, 8.22, 9.25, 9.26, 10.49, 10.67, 12.23, 12.9, 17.16,
        17.74, 19.51, 19.67,
      ];
      const pts = speeds.map((mps, i) => withSpeed(i * 30_000, mps));
      expect(modeForSection(mkSection('unknown', pts))).toBe('car');
    });

    it('steady casual bike at ~18 km/h → bike', () => {
      // p75 around 5.5 m/s — between bikeThreshold (3.33) and carThreshold (6.94)
      const pts = [
        withSpeed(0, 4.0),
        withSpeed(10_000, 4.5),
        withSpeed(20_000, 5.0),
        withSpeed(30_000, 5.5),
        withSpeed(40_000, 6.0),
        withSpeed(50_000, 5.8),
      ];
      expect(modeForSection(mkSection('unknown', pts))).toBe('bike');
    });

    it('single reported speed falls back to haversine', () => {
      // < 2 reported values can't form a meaningful p75; fall through to
      // haversine of segments instead.
      const pts = [
        mkPoint(0, 0, 0, 5, 5.0),
        mkPoint(25_000, 0, 0.001), // ~111m / 25s = 4.44 m/s haversine
      ];
      // p75 of [4.44] (only 1 segment) = 4.44 → bike
      expect(modeForSection(mkSection('unknown', pts))).toBe('bike');
    });
  });
});
