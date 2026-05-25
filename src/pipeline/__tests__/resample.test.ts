import { resample } from '../resample';
import { mkPoint, resetIds } from './_fixtures';

describe('resample', () => {
  beforeEach(() => resetIds());

  it('produces N+1 points for an N×intervalMs span', () => {
    const pts = [
      mkPoint(0, 0, 0),
      mkPoint(50_000, 0.005, 0),
    ];
    const out = resample(pts, { intervalMs: 10_000 });
    expect(out.map((p) => p.timestampMs)).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000]);
  });

  it('interpolates lat/lon linearly', () => {
    const pts = [
      mkPoint(0, 0, 0),
      mkPoint(10_000, 1, 1),
    ];
    const out = resample(pts, { intervalMs: 5000 });
    expect(out.map((p) => p.latitude)).toEqual([0, 0.5, 1]);
    expect(out.map((p) => p.longitude)).toEqual([0, 0.5, 1]);
  });
});
