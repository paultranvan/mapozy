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

describe('co2GramsForSection — plane (distance-tiered × radiative forcing)', () => {
  // base kg/km × RF 1.9 → g = km × factor × 1000
  it('short-haul (< 1000 km) uses 0.230 × 1.9', () => {
    // 500 km × 0.437 = 218.5 kg
    expect(co2GramsForSection('plane', 500_000)).toBeCloseTo(218_500, 0);
  });

  it('medium-haul (1000–3500 km) uses 0.178 × 1.9', () => {
    // 2000 km × 0.3382 = 676.4 kg
    expect(co2GramsForSection('plane', 2_000_000)).toBeCloseTo(676_400, 0);
  });

  it('long-haul (≥ 3500 km) uses 0.152 × 1.9', () => {
    // 5000 km × 0.2888 = 1444 kg
    expect(co2GramsForSection('plane', 5_000_000)).toBeCloseTo(1_444_000, 0);
  });

  it('tier boundary at 1000 km falls into medium-haul', () => {
    expect(co2GramsForSection('plane', 1_000_000)).toBeCloseTo(338_200, 0);
  });

  it('tier boundary at 3500 km falls into long-haul', () => {
    expect(co2GramsForSection('plane', 3_500_000)).toBeCloseTo(1_010_800, 0);
  });
});
