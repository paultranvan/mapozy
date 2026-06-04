import {
  isMetroStation,
  qualifiesAsSubwayGap,
  buildSubwaySection,
  rebuildWithSubway,
  recomputeTotals,
} from '../subwayGaps';
import type { Section, TripBreak } from '../../../types';
import type { TransitStop } from '../../../lib/overpass';

const lon0 = 5.0;
const lat0 = 45.0;

function sec(ordering: number, mode: Section['mode'], coords: Array<[number, number]>): Section {
  return {
    ordering,
    startTimeMs: ordering * 1000,
    endTimeMs: ordering * 1000 + 500,
    mode,
    distanceM: 100,
    durationS: 1,
    avgSpeedMps: 1,
    maxSpeedMps: 1,
    co2G: 0,
    geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
  };
}

describe('isMetroStation', () => {
  it('matches station=subway, subway_entrance', () => {
    expect(isMetroStation({ id: 1, lat: 0, lon: 0, station: 'subway', busStop: false })).toBe(true);
    expect(isMetroStation({ id: 2, lat: 0, lon: 0, railway: 'subway_entrance', busStop: false })).toBe(true);
  });
  it('rejects a bus stop or heavy-rail station', () => {
    expect(isMetroStation({ id: 3, lat: 0, lon: 0, busStop: true })).toBe(false);
    expect(isMetroStation({ id: 4, lat: 0, lon: 0, railway: 'station', busStop: false })).toBe(false);
  });
});

describe('qualifiesAsSubwayGap', () => {
  const entry: [number, number] = [lon0, lat0];
  const exit: [number, number] = [lon0 + 0.01, lat0]; // ~787 m
  it('true for a gap break of plausible length and distance', () => {
    const b: TripBreak = { ordering: 0, startTimeMs: 0, endTimeMs: 10 * 60_000, centerLat: lat0, centerLon: lon0, gap: true };
    expect(qualifiesAsSubwayGap(b, entry, exit)).toBe(true);
  });
  it('false for a non-gap break', () => {
    const b: TripBreak = { ordering: 0, startTimeMs: 0, endTimeMs: 10 * 60_000, centerLat: lat0, centerLon: lon0, gap: false };
    expect(qualifiesAsSubwayGap(b, entry, exit)).toBe(false);
  });
  it('false when endpoints are too close', () => {
    const b: TripBreak = { ordering: 0, startTimeMs: 0, endTimeMs: 10 * 60_000, centerLat: lat0, centerLon: lon0, gap: true };
    expect(qualifiesAsSubwayGap(b, entry, [lon0 + 0.0005, lat0])).toBe(false); // ~39 m
  });
  it('false when too long', () => {
    const b: TripBreak = { ordering: 0, startTimeMs: 0, endTimeMs: 60 * 60_000, centerLat: lat0, centerLon: lon0, gap: true };
    expect(qualifiesAsSubwayGap(b, entry, exit)).toBe(false);
  });
});

describe('buildSubwaySection', () => {
  it('spans the break time, straight entry→exit geometry, subway mode/co2', () => {
    const b: TripBreak = { ordering: 0, startTimeMs: 1000, endTimeMs: 1000 + 600_000, centerLat: lat0, centerLon: lon0, gap: true };
    const s = buildSubwaySection(b, [lon0, lat0], [lon0 + 0.01, lat0]);
    expect(s.mode).toBe('subway');
    expect(s.modeSource).toBe('gap');
    expect(s.startTimeMs).toBe(1000);
    expect(s.endTimeMs).toBe(1000 + 600_000);
    expect(JSON.parse(s.geojson).coordinates).toEqual([[lon0, lat0], [lon0 + 0.01, lat0]]);
    expect(s.distanceM).toBeGreaterThan(700);
    expect(s.co2G).toBeGreaterThan(0);
  });
});

describe('rebuildWithSubway + recomputeTotals', () => {
  it('inserts the subway section in place of the converted break and renumbers', () => {
    // walk (0) | break@0 | walk (1)
    const sections = [
      sec(0, 'walk', [[lon0, lat0], [lon0, lat0 + 0.0005]]),
      sec(1, 'walk', [[lon0 + 0.01, lat0], [lon0 + 0.01, lat0 + 0.0005]]),
    ];
    const breaks: TripBreak[] = [
      { ordering: 0, startTimeMs: 600, endTimeMs: 600 + 600_000, centerLat: lat0, centerLon: lon0, gap: true },
    ];
    const subway = buildSubwaySection(breaks[0]!, [lon0, lat0 + 0.0005], [lon0 + 0.01, lat0]);
    const conversions = new Map<number, Section>([[0, subway]]);

    const out = rebuildWithSubway(sections, breaks, conversions);
    expect(out.sections.map((s) => s.mode)).toEqual(['walk', 'subway', 'walk']);
    expect(out.sections.map((s) => s.ordering)).toEqual([0, 1, 2]);
    expect(out.breaks).toHaveLength(0);

    const totals = recomputeTotals(out.sections);
    expect(totals.dominantMode).toBe('subway'); // subway leg is the longest
    expect(JSON.parse(totals.geojson).coordinates.length).toBeGreaterThan(0);
    expect(totals.distanceM).toBeGreaterThan(0);
  });

  it('keeps an unconverted break as a break with shifted ordering', () => {
    const sections = [sec(0, 'walk', [[lon0, lat0]]), sec(1, 'walk', [[lon0 + 0.01, lat0]])];
    const breaks: TripBreak[] = [
      { ordering: 0, startTimeMs: 600, endTimeMs: 1200, centerLat: lat0, centerLon: lon0, gap: false },
    ];
    const out = rebuildWithSubway(sections, breaks, new Map());
    expect(out.sections).toHaveLength(2);
    expect(out.breaks).toHaveLength(1);
    expect(out.breaks[0]!.ordering).toBe(0);
  });

  it('renumbers correctly with two breaks when only the first converts', () => {
    // S0 | break@0 (convert→subway) | S1 | break@1 (keep) | S2
    const sections = [
      sec(0, 'walk', [[lon0, lat0], [lon0, lat0 + 0.0005]]),
      sec(1, 'walk', [[lon0 + 0.01, lat0], [lon0 + 0.01, lat0 + 0.0005]]),
      sec(2, 'walk', [[lon0 + 0.02, lat0], [lon0 + 0.02, lat0 + 0.0005]]),
    ];
    const breaks: TripBreak[] = [
      { ordering: 0, startTimeMs: 600, endTimeMs: 600 + 600_000, centerLat: lat0, centerLon: lon0, gap: true },
      { ordering: 1, startTimeMs: 1200, endTimeMs: 1800, centerLat: lat0, centerLon: lon0, gap: false },
    ];
    const subway = buildSubwaySection(breaks[0]!, [lon0, lat0 + 0.0005], [lon0 + 0.01, lat0]);
    const out = rebuildWithSubway(sections, breaks, new Map([[0, subway]]));

    // Stream becomes: S0, subway, S1, S2 — and the kept break now follows S1 (index 2).
    expect(out.sections.map((s) => s.mode)).toEqual(['walk', 'subway', 'walk', 'walk']);
    expect(out.sections.map((s) => s.ordering)).toEqual([0, 1, 2, 3]);
    expect(out.breaks).toHaveLength(1);
    expect(out.breaks[0]!.ordering).toBe(2); // follows S1, which sits at index 2
  });
});
