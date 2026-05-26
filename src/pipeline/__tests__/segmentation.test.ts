import { segmentation } from '../segmentation';
import { mkPoint, mkActivity, syntheticTrip, resetIds } from './_fixtures';
import type { RawPoint, RawActivity } from '../../types';

describe('segmentation', () => {
  beforeEach(() => resetIds());

  it('returns no trips when fewer than 2 dwell windows', () => {
    // single stay point set
    const pts = [
      mkPoint(0, 45.764, 4.8357),
      mkPoint(60_000, 45.764, 4.8357),
    ];
    const segs = segmentation(pts, [], { dwellMinutes: 1, dwellRadiusM: 50 });
    expect(segs.filter((s) => s.kind === 'trip')).toHaveLength(0);
  });

  it('detects a single trip between two dwell windows in synthetic data', () => {
    const { points } = syntheticTrip();
    const segs = segmentation(points, [], { dwellMinutes: 5, dwellRadiusM: 100 });
    const trips = segs.filter((s) => s.kind === 'trip');
    const stays = segs.filter((s) => s.kind === 'stay');
    expect(trips).toHaveLength(1);
    expect(stays).toHaveLength(2);
  });

  it('does not treat a 6-min stationary window as a stay when in_vehicle activity is present (traffic jam)', () => {
    const t0 = 1_700_000_000_000;
    const lat = 48.85;
    const lon = 2.35;
    const pts: RawPoint[] = [];
    for (let i = 0; i <= 6; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat, lon));
    }
    const acts: RawActivity[] = [];
    for (let i = 0; i <= 6; i++) {
      acts.push(mkActivity(t0 + i * 60_000, 'in_vehicle', 85));
    }
    const segs = segmentation(pts, acts, { dwellMinutes: 5, dwellRadiusM: 100 });
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(0);
  });

  it('still treats a 6-min stationary window as a stay when activity is still/on_foot', () => {
    const t0 = 1_700_000_000_000;
    const lat = 48.85;
    const lon = 2.35;
    const pts: RawPoint[] = [];
    for (let i = 0; i <= 6; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat, lon));
    }
    const acts: RawActivity[] = [];
    for (let i = 0; i <= 6; i++) {
      acts.push(mkActivity(t0 + i * 60_000, 'still', 95));
    }
    const segs = segmentation(pts, acts, { dwellMinutes: 5, dwellRadiusM: 100 });
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(1);
  });

  it('still treats a 6-min stationary window as a stay when no activities are recorded (back-compat)', () => {
    const t0 = 1_700_000_000_000;
    const lat = 48.85;
    const lon = 2.35;
    const pts: RawPoint[] = [];
    for (let i = 0; i <= 6; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat, lon));
    }
    const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100 });
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(1);
  });

  it('treats a long gap at a different location as an implicit stay', () => {
    // Home cluster, then a walk, then a 2h gap, then home again
    const t0 = 1_700_000_000_000;
    const lat0 = 48.7737;
    const lon0 = 2.3226;
    const pts: ReturnType<typeof mkPoint>[] = [];
    // Stay at home for 10 minutes
    for (let i = 0; i <= 10; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat0, lon0));
    }
    // Walk 1km north over 5 min
    const walkStart = t0 + 11 * 60_000;
    for (let i = 1; i <= 5; i++) {
      pts.push(mkPoint(walkStart + i * 60_000, lat0 + 0.002 * i, lon0));
    }
    // 2h gap, then home again for 10 min
    const homeAgain = walkStart + 5 * 60_000 + 2 * 60 * 60_000;
    for (let i = 0; i <= 10; i++) {
      pts.push(mkPoint(homeAgain + i * 60_000, lat0, lon0));
    }

    const segs = segmentation(pts, [], {
      dwellMinutes: 5,
      dwellRadiusM: 100,
      gapMinutes: 10,
    });
    const stays = segs.filter((s) => s.kind === 'stay');
    const trips = segs.filter((s) => s.kind === 'trip');
    // Expect: home stay + outbound trip + gap stay + inferred return trip + home2 stay
    expect(stays).toHaveLength(3);
    expect(trips).toHaveLength(2);
  });
});
