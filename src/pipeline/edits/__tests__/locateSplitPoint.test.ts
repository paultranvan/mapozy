import { locateSplitPoint } from '../locateSplitPoint';
import type { Section } from '../../../types';

function line(coords: Array<[number, number]>): string {
  return JSON.stringify({ type: 'LineString', coordinates: coords });
}
function sec(id: number, coords: Array<[number, number]>): Section {
  return {
    id,
    ordering: id,
    startTimeMs: 0,
    endTimeMs: 1000,
    mode: 'car',
    distanceM: 0,
    durationS: 1,
    avgSpeedMps: 0,
    maxSpeedMps: 0,
    co2G: 0,
    geojson: line(coords),
  };
}

describe('locateSplitPoint', () => {
  const sections = [
    sec(10, [[0, 0], [0, 0.001], [0, 0.002], [0, 0.003]]),
    sec(11, [[0, 0.003], [0, 0.004], [0, 0.005], [0, 0.006]]),
  ];
  it('finds the nearest interior vertex across sections', () => {
    const r = locateSplitPoint(sections, [0, 0.00401]);
    expect(r).toEqual({ sectionId: 11, vertexIndex: 1 });
  });
  it('never returns an endpoint vertex (would create an empty half)', () => {
    const r = locateSplitPoint(sections, [0, -1]);
    expect(r).toEqual({ sectionId: 10, vertexIndex: 1 });
  });
  it('returns null when no section has an interior vertex', () => {
    expect(locateSplitPoint([sec(1, [[0, 0], [0, 1]])], [0, 0])).toBeNull();
  });
});
