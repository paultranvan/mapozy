import { haversineMeters, pathLengthMeters } from '../distance';

describe('distance', () => {
  it('haversine: zero for same point', () => {
    expect(haversineMeters(45, 4, 45, 4)).toBe(0);
  });

  it('haversine: ~111km for 1 degree latitude', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -3);
  });

  it('haversine: small distance between close points', () => {
    // ~100m east at lat 45
    const d = haversineMeters(45, 0, 45, 0.00127);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });

  it('pathLength: sums consecutive segments', () => {
    const len = pathLengthMeters([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(len).toBeCloseTo(222_390, -3);
  });

  it('pathLength: zero for less than two points', () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([[1, 2]])).toBe(0);
  });
});
