import { co2GramsForSection } from '../compute';

describe('co2/compute', () => {
  it('returns 0 for walking', () => {
    expect(co2GramsForSection('walk', 10_000)).toBe(0);
  });
  it('218 g/km for car (10 km → 2180 g)', () => {
    expect(co2GramsForSection('car', 10_000)).toBeCloseTo(2180, 1);
  });
  it('falls back to car factor for unknown mode', () => {
    expect(co2GramsForSection('helicopter', 10_000)).toBeCloseTo(2180, 1);
  });
});

describe('co2GramsForSection — transit modes', () => {
  it('tram uses the tram factor (g = km * factor * 1000)', () => {
    // 0.0046 kg/km over 1 km = 4.6 g
    expect(co2GramsForSection('tram', 1000)).toBeCloseTo(4.6, 3);
  });

  it('subway uses the subway factor', () => {
    // 0.0036 kg/km over 1 km = 3.6 g
    expect(co2GramsForSection('subway', 1000)).toBeCloseTo(3.6, 3);
  });

  it('bus and train keep their existing factors', () => {
    expect(co2GramsForSection('bus', 1000)).toBeCloseTo(103, 3);
    expect(co2GramsForSection('train', 1000)).toBeCloseTo(24.1, 3);
  });

  it('unknown mode still falls back to the car factor', () => {
    expect(co2GramsForSection('not-a-mode', 1000)).toBeCloseTo(218, 3);
  });
});
