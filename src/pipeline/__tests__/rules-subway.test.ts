import { RULES } from '../rules';

describe('subway gap rules', () => {
  it('SUBWAY_GAP has duration + distance bounds', () => {
    expect(RULES.SUBWAY_GAP.defaults.minMinutes).toBe(2);
    expect(RULES.SUBWAY_GAP.defaults.maxMinutes).toBe(40);
    expect(RULES.SUBWAY_GAP.defaults.minDistanceM).toBe(200);
  });
  it('SUBWAY_STATION_RADIUS is wider than the surface stop radius', () => {
    expect(RULES.SUBWAY_STATION_RADIUS.defaults.radiusM).toBe(150);
    expect(RULES.SUBWAY_STATION_RADIUS.defaults.radiusM).toBeGreaterThan(
      RULES.TRANSIT_STOP_RADIUS.defaults.radiusM
    );
  });
});
