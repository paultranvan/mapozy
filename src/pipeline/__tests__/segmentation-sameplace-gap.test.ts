import { segmentation } from '../segmentation';
import { mkPoint, resetIds } from './_fixtures';
import type { RawPoint } from '../../types';
import fixture from './fixtures/sameplace-gap-2026-07-31.json';

type Segment = ReturnType<typeof segmentation>[number];
type Stay = Extract<Segment, { kind: 'stay' }>;

function stays(segs: Segment[]): Stay[] {
  return segs.filter((s): s is Stay => s.kind === 'stay');
}

describe('RULE_GAP_DWELL: same-place tracking gap after a closed dwell window', () => {
  beforeEach(() => resetIds());

  it('real data (2026-07-31 tester export): a 1h47 GPS silence at a bar is a stay, not part of the trip', () => {
    // 12 fixes at the bar over ~6 min (dwell window closes at the last one,
    // because the post-gap fix sits ~110 m from the window centroid but only
    // 98 m from the last pre-gap fix), then a 6405 s silence, then the walk
    // away. Before the fix: a 4-min break, and the 1h47 silence is swallowed
    // into the trip (Home → bar → Quai d'Austerlitz came out as ONE 3h11 trip).
    const pts: RawPoint[] = fixture.points.map(([t, lat, lon, acc, v]) =>
      mkPoint(t as number, lat as number, lon as number, acc as number, v as number | null)
    );
    const segs = segmentation(pts, []);
    const long = stays(segs).filter((s) => s.endMs - s.startMs >= 60 * 60_000);
    expect(long).toHaveLength(1);
    // The stay must run from the bar arrival to where GPS resumed.
    expect(long[0]!.startMs).toBeLessThanOrEqual(1785523712923);
    expect(long[0]!.endMs).toBeGreaterThanOrEqual(1785530117746);
  });

  it('synthetic: the dwell window ends on the last pre-gap fix and the post-gap fix is within the radius of it', () => {
    const mpdLat = 111_320;
    const t0 = 1_700_000_000_000;
    const lat0 = 48.0;
    const lon0 = 2.0;
    const pts: RawPoint[] = [];
    // Approach from 400 m south (a walk), then 6 min of fixes at the place.
    for (let i = 0; i < 4; i++) pts.push(mkPoint(t0 + i * 60_000, lat0 - (400 - i * 100) / mpdLat, lon0));
    const arrive = t0 + 4 * 60_000;
    for (let i = 0; i <= 6; i++) pts.push(mkPoint(arrive + i * 60_000, lat0, lon0));
    const lastPre = arrive + 6 * 60_000;
    // 2 h silence, GPS resumes 95 m north of the last fix (same place), then
    // walk away north.
    const resume = lastPre + 2 * 60 * 60_000;
    for (let i = 0; i <= 8; i++) {
      pts.push(mkPoint(resume + i * 60_000, lat0 + (95 + i * 80) / mpdLat, lon0));
    }
    const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100, gapMinutes: 10 });
    const long = stays(segs).filter((s) => s.endMs - s.startMs >= 60 * 60_000);
    expect(long).toHaveLength(1);
    expect(long[0]!.startMs).toBeLessThanOrEqual(lastPre);
    expect(long[0]!.endMs).toBeGreaterThanOrEqual(resume);
    // And no trip may straddle the silence.
    for (const s of segs) {
      if (s.kind !== 'trip') continue;
      const dur = s.points[s.points.length - 1]!.timestampMs - s.points[0]!.timestampMs;
      expect(dur).toBeLessThan(60 * 60_000);
    }
  });
});
