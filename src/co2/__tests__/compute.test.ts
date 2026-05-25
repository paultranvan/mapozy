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
