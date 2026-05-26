import { smoothing } from '../smoothing';
import { mkPoint, resetIds } from './_fixtures';

describe('smoothing', () => {
  beforeEach(() => resetIds());

  it('keeps a smooth straight line untouched', () => {
    const pts = [
      mkPoint(0, 45.0, 5.0),
      mkPoint(10_000, 45.0, 5.00001),
      mkPoint(20_000, 45.0, 5.00002),
      mkPoint(30_000, 45.0, 5.00003),
      mkPoint(40_000, 45.0, 5.00004),
    ];
    const out = smoothing(pts);
    expect(out).toHaveLength(5);
  });

  it('removes a single big spike in the middle', () => {
    const pts = [
      mkPoint(0, 45.0, 5.0),
      mkPoint(10_000, 45.0, 5.00001),
      mkPoint(20_000, 45.076, 5.00002), // spike: ~10km north
      mkPoint(30_000, 45.0, 5.00003),
      mkPoint(40_000, 45.0, 5.00004),
    ];
    const out = smoothing(pts);
    expect(out).toHaveLength(4);
    expect(out.find((p) => p.latitude > 45.07)).toBeUndefined();
  });
});
