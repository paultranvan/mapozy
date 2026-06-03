import { RULES } from '../rules';

describe('transit classification rules', () => {
  it('RAIL_MAP_MATCH has coverage + buffer defaults', () => {
    expect(RULES.RAIL_MAP_MATCH.defaults.coverageMin).toBeCloseTo(0.8, 5);
    expect(RULES.RAIL_MAP_MATCH.defaults.bufferM).toBe(25);
  });
  it('TRANSIT_STOP_RADIUS default radius is 70 m', () => {
    expect(RULES.TRANSIT_STOP_RADIUS.defaults.radiusM).toBe(70);
  });
});
