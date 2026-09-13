import { absorbGapBreaksIntoRailLegs } from '../transit/subwayGaps';
import type { Section, TripBreak } from '../../types';

function sec(o: number, start: number, end: number, mode: Section['mode'], distanceM: number): Section {
  const durationS = Math.max(1, Math.round((end - start) / 1000));
  return {
    ordering: o,
    startTimeMs: start,
    endTimeMs: end,
    mode,
    distanceM,
    durationS,
    avgSpeedMps: distanceM / durationS,
    maxSpeedMps: distanceM / durationS,
    co2G: 0,
    geojson: JSON.stringify({ type: 'LineString', coordinates: [[2, 48], [2.1, 48.05]] }),
  };
}

describe('absorbGapBreaksIntoRailLegs', () => {
  const t0 = 1_700_000_000_000;
  const gapStart = t0 + 10 * 60_000; // last fix before going underground
  const resume = gapStart + 28 * 60_000; // GPS back, 8 km away
  const legStart = resume - 5 * 60_000; // synthetic leg = last 5 min of the gap stay

  it('folds a gap break into the synthetic rail leg that follows it', () => {
    const sections = [
      sec(0, t0, gapStart, 'walk', 1500),
      sec(1, legStart, resume, 'subway', 8279),
      sec(2, resume, resume + 8 * 60_000, 'walk', 480),
    ];
    const breaks: TripBreak[] = [
      { ordering: 0, startTimeMs: gapStart, endTimeMs: legStart, centerLat: 48, centerLon: 2, gap: true },
    ];
    const r = absorbGapBreaksIntoRailLegs(sections, breaks);
    expect(r.changed).toBe(true);
    expect(r.breaks).toHaveLength(0);
    expect(r.sections[1]!.startTimeMs).toBe(gapStart);
    expect(r.sections[1]!.durationS).toBe(28 * 60);
    expect(r.sections[1]!.avgSpeedMps).toBeCloseTo(8279 / (28 * 60), 3);
    expect(r.sections[1]!.maxSpeedMps).toBeLessThan(10);
    // untouched inputs
    expect(sections[1]!.startTimeMs).toBe(legStart);
  });

  it('leaves a gap break alone when the following leg is not rail or not the synthetic one', () => {
    const sections = [
      sec(0, t0, gapStart, 'walk', 1500),
      sec(1, legStart, resume, 'car', 8279),
    ];
    const breaks: TripBreak[] = [
      { ordering: 0, startTimeMs: gapStart, endTimeMs: legStart, centerLat: 48, centerLon: 2, gap: true },
    ];
    expect(absorbGapBreaksIntoRailLegs(sections, breaks).changed).toBe(false);
    const real = [sec(0, t0, gapStart, 'walk', 1500), sec(1, resume, resume + 60_000, 'subway', 500)];
    const b2: TripBreak[] = [
      { ordering: 0, startTimeMs: gapStart, endTimeMs: resume, centerLat: 48, centerLon: 2, gap: false },
    ];
    expect(absorbGapBreaksIntoRailLegs(real, b2).changed).toBe(false);
  });
});
