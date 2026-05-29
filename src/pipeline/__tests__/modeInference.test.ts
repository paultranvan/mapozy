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

  describe('unknown activity', () => {
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
});
