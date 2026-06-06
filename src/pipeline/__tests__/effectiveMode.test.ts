import { effectiveMode, effectiveDominantMode, effectiveCo2Total } from '../effectiveMode';
import type { Section } from '../../types';

function sec(partial: Partial<Section>): Section {
  return {
    ordering: 0,
    startTimeMs: 0,
    endTimeMs: 1000,
    mode: 'car',
    distanceM: 1000,
    durationS: 100,
    avgSpeedMps: 10,
    maxSpeedMps: 12,
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
    ...partial,
  };
}

describe('effectiveMode', () => {
  it('prefers user_mode over auto mode', () => {
    expect(effectiveMode(sec({ mode: 'car', userMode: 'train' }))).toBe('train');
    expect(effectiveMode(sec({ mode: 'car', userMode: null }))).toBe('car');
    expect(effectiveMode(sec({ mode: 'car' }))).toBe('car');
  });

  it('effectiveDominantMode uses overrides', () => {
    const sections = [
      sec({ mode: 'car', userMode: 'train', distanceM: 9000 }),
      sec({ mode: 'walk', distanceM: 1000 }),
    ];
    expect(effectiveDominantMode(sections)).toBe('train');
  });

  it('effectiveCo2Total sums CO2 by effective mode', () => {
    // walk factor is 0, so overriding car→walk yields zero CO2.
    const sections = [sec({ mode: 'car', userMode: 'walk', distanceM: 2000 })];
    expect(effectiveCo2Total(sections)).toBe(0);
  });
});
