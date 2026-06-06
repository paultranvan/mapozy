import {
  parseCoords,
  coordsToGeojson,
  statsFromCoords,
  splitSectionAt,
  mergeSectionPair,
} from '../sectionGeometry';
import type { Section } from '../../../types';

function line(coords: Array<[number, number]>): string {
  return JSON.stringify({ type: 'LineString', coordinates: coords });
}

function sec(partial: Partial<Section>): Section {
  return {
    ordering: 0,
    startTimeMs: 0,
    endTimeMs: 100_000,
    mode: 'car',
    distanceM: 0,
    durationS: 100,
    avgSpeedMps: 0,
    maxSpeedMps: 0,
    co2G: 0,
    geojson: line([[0, 0]]),
    ...partial,
  };
}

describe('parseCoords / coordsToGeojson', () => {
  it('round-trips coordinates', () => {
    const c: Array<[number, number]> = [[1, 2], [3, 4]];
    expect(parseCoords(coordsToGeojson(c))).toEqual(c);
  });
  it('returns [] for malformed json', () => {
    expect(parseCoords('not json')).toEqual([]);
  });
});

describe('statsFromCoords', () => {
  it('computes distance/duration/avg', () => {
    const s = statsFromCoords([[0, 0], [0, 0.001]], 0, 10_000);
    expect(s.distanceM).toBeGreaterThan(100);
    expect(s.distanceM).toBeLessThan(120);
    expect(s.durationS).toBe(10);
    expect(s.avgSpeedMps).toBeCloseTo(s.distanceM / 10, 5);
  });
});

describe('splitSectionAt', () => {
  it('splits coords at the vertex, sharing the cut point, and interpolates time', () => {
    const s = sec({
      geojson: line([[0, 0], [0, 0.001], [0, 0.002], [0, 0.003], [0, 0.004]]),
      startTimeMs: 0,
      endTimeMs: 40_000,
      mode: 'car',
      userMode: 'train',
    });
    const [a, b] = splitSectionAt(s, 2);
    expect(parseCoords(a.geojson)).toEqual([[0, 0], [0, 0.001], [0, 0.002]]);
    expect(parseCoords(b.geojson)).toEqual([[0, 0.002], [0, 0.003], [0, 0.004]]);
    expect(a.startTimeMs).toBe(0);
    expect(a.endTimeMs).toBe(20_000);
    expect(b.startTimeMs).toBe(20_000);
    expect(b.endTimeMs).toBe(40_000);
    expect(a.mode).toBe('car');
    expect(a.userMode).toBe('train');
    expect(b.userMode).toBe('train');
    expect(a.modeSource).toBe('manual');
  });
});

describe('mergeSectionPair', () => {
  it('concatenates coords (dedup shared vertex), spans times, picks longer leg mode', () => {
    const a = sec({
      geojson: line([[0, 0], [0, 0.001]]),
      startTimeMs: 0,
      endTimeMs: 10_000,
      mode: 'walk',
      distanceM: 111,
    });
    const b = sec({
      geojson: line([[0, 0.001], [0, 0.01]]),
      startTimeMs: 10_000,
      endTimeMs: 20_000,
      mode: 'car',
      distanceM: 1000,
    });
    const m = mergeSectionPair(a, b);
    expect(parseCoords(m.geojson)).toEqual([[0, 0], [0, 0.001], [0, 0.01]]);
    expect(m.startTimeMs).toBe(0);
    expect(m.endTimeMs).toBe(20_000);
    expect(m.mode).toBe('car');
    expect(m.userMode).toBeNull();
    expect(m.modeSource).toBe('manual');
  });
});
