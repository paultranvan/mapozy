import { classifySection } from '../classifySection';
import type { RailwayWay, TransitStop } from '../../../lib/overpass';

const lat0 = 45.0;
const lon0 = 5.0;

// A north-south trace and a coincident railway way.
function straightTrace(n = 10): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) out.push([lon0, lat0 + 0.0005 * i]);
  return out;
}
function wayAlongTrace(railway: string): RailwayWay {
  return { id: 1, railway, coords: [[lon0, lat0], [lon0, lat0 + 0.0005 * 9]] };
}

describe('classifySection — rail map-match', () => {
  it('trace following a rail way → train', () => {
    const r = classifySection({
      coords: straightTrace(),
      ways: [wayAlongTrace('rail')],
      startStops: [],
      endStops: [],
    });
    expect(r?.mode).toBe('train');
    expect(r?.modeSource).toBe('railmatch');
  });

  it('tram way → tram; subway way → subway; light_rail → tram', () => {
    expect(
      classifySection({ coords: straightTrace(), ways: [wayAlongTrace('tram')], startStops: [], endStops: [] })?.mode
    ).toBe('tram');
    expect(
      classifySection({ coords: straightTrace(), ways: [wayAlongTrace('subway')], startStops: [], endStops: [] })?.mode
    ).toBe('subway');
    expect(
      classifySection({ coords: straightTrace(), ways: [wayAlongTrace('light_rail')], startStops: [], endStops: [] })?.mode
    ).toBe('tram');
  });

  it('trace NOT near any rail way → null (stays car)', () => {
    const farWay: RailwayWay = {
      id: 2,
      railway: 'rail',
      coords: [[lon0 + 0.01, lat0], [lon0 + 0.01, lat0 + 0.005]], // ~787 m east
    };
    expect(
      classifySection({ coords: straightTrace(), ways: [farWay], startStops: [], endStops: [] })
    ).toBeNull();
  });
});

describe('classifySection — station corroboration', () => {
  it('rail station at both endpoints → that mode when no way match', () => {
    const start: TransitStop[] = [
      { id: 1, lat: lat0, lon: lon0, station: 'subway', busStop: false },
    ];
    const end: TransitStop[] = [
      { id: 2, lat: lat0, lon: lon0, station: 'subway', busStop: false },
    ];
    const r = classifySection({ coords: straightTrace(), ways: [], startStops: start, endStops: end });
    expect(r?.mode).toBe('subway');
    expect(r?.modeSource).toBe('station');
  });

  it('station at only one endpoint → null', () => {
    const start: TransitStop[] = [
      { id: 1, lat: lat0, lon: lon0, railway: 'station', busStop: false },
    ];
    expect(
      classifySection({ coords: straightTrace(), ways: [], startStops: start, endStops: [] })
    ).toBeNull();
  });
});

describe('classifySection — bus route_ref', () => {
  it('shared route_ref at both bus stops → bus', () => {
    const start: TransitStop[] = [
      { id: 1, lat: lat0, lon: lon0, busStop: true, routeRef: '12;38' },
    ];
    const end: TransitStop[] = [
      { id: 2, lat: lat0, lon: lon0, busStop: true, routeRef: '38;91' },
    ];
    const r = classifySection({ coords: straightTrace(), ways: [], startStops: start, endStops: end });
    expect(r?.mode).toBe('bus');
  });

  it('bus stops with NO shared route_ref → null (no false positive)', () => {
    const start: TransitStop[] = [
      { id: 1, lat: lat0, lon: lon0, busStop: true, routeRef: '12' },
    ];
    const end: TransitStop[] = [
      { id: 2, lat: lat0, lon: lon0, busStop: true, routeRef: '38' },
    ];
    expect(
      classifySection({ coords: straightTrace(), ways: [], startStops: start, endStops: end })
    ).toBeNull();
  });
});
