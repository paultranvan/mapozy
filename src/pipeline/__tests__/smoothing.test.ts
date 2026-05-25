import { smoothing } from '../smoothing';
import { mkPoint, resetIds } from './_fixtures';

describe('smoothing', () => {
  beforeEach(() => resetIds());

  it('keeps a smooth straight line untouched', () => {
    const pts = [
      mkPoint(0, 45.764, 4.8357),
      mkPoint(10_000, 45.764, 4.83571),
      mkPoint(20_000, 45.764, 4.83572),
      mkPoint(30_000, 45.764, 4.83573),
      mkPoint(40_000, 45.764, 4.83574),
    ];
    const out = smoothing(pts);
    expect(out).toHaveLength(5);
  });

  it('removes a single big spike in the middle', () => {
    const pts = [
      mkPoint(0, 45.764, 4.8357),
      mkPoint(10_000, 45.764, 4.83571),
      mkPoint(20_000, 45.84, 4.83572), // spike: ~10km north
      mkPoint(30_000, 45.764, 4.83573),
      mkPoint(40_000, 45.764, 4.83574),
    ];
    const out = smoothing(pts);
    expect(out).toHaveLength(4);
    expect(out.find((p) => p.latitude > 45.8)).toBeUndefined();
  });
});
