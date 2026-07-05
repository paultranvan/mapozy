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

describe('sharedEndpointBusRefs', () => {
  it('collects the refs served at both endpoints', () => {
    const start: TransitStop[] = [
      { id: 1, lat: lat0, lon: lon0, busStop: true, routeRef: '12;38' },
    ];
    const end: TransitStop[] = [
      { id: 2, lat: lat0, lon: lon0, busStop: true, routeRef: '38;91' },
    ];
    expect([...sharedEndpointBusRefs(start, end)]).toEqual(['38']);
  });

  it('no shared route_ref → empty set', () => {
    const start: TransitStop[] = [
      { id: 1, lat: lat0, lon: lon0, busStop: true, routeRef: '12' },
    ];
    const end: TransitStop[] = [
      { id: 2, lat: lat0, lon: lon0, busStop: true, routeRef: '38' },
    ];
    expect(sharedEndpointBusRefs(start, end).size).toBe(0);
  });

  it('classifySection itself never returns bus from endpoint stops alone', () => {
    // Five 2026-06 car commutes were classified bus this way (both ends near
    // stops of the same home↔Cachan line). Endpoint sharing is structural
    // evidence only — it must go through the corridor scorer's dwell gate.
    const start: TransitStop[] = [
      { id: 1, lat: lat0, lon: lon0, busStop: true, routeRef: '12;38' },
    ];
    const end: TransitStop[] = [
      { id: 2, lat: lat0, lon: lon0, busStop: true, routeRef: '38;91' },
    ];
    expect(
      classifySection({ coords: straightTrace(), ways: [], startStops: start, endStops: end })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bus corridor (step 4) — door-to-door bus with no stop at either endpoint.
// ---------------------------------------------------------------------------
import { classifyBusCorridor, samplePathEvery, sharedEndpointBusRefs } from '../classifySection';

function busStop(id: number, routeRef: string): TransitStop {
  return { id, lat: lat0, lon: lon0, busStop: true, routeRef };
}

describe('samplePathEvery', () => {
  it('samples roughly one point per everyM of path length', () => {
    // 0.0005° lat ≈ 55.6 m per step; 100 steps ≈ 5.56 km.
    const coords: Array<[number, number]> = [];
    for (let i = 0; i <= 100; i++) coords.push([lon0, lat0 + 0.0005 * i]);
    const samples = samplePathEvery(coords, 400);
    expect(samples.length).toBeGreaterThanOrEqual(13);
    expect(samples.length).toBeLessThanOrEqual(16);
    expect(samples[0]).toEqual(coords[0]);
  });

  it('handles empty and single-point input', () => {
    expect(samplePathEvery([], 400)).toEqual([]);
    expect(samplePathEvery([[lon0, lat0]], 400)).toEqual([[lon0, lat0]]);
  });
});

describe('classifyBusCorridor', () => {
  // A ~5.5 km north-south path, one point every ~55.6 m (0.0005° lat).
  const path: Array<[number, number]> = [];
  for (let i = 0; i <= 100; i++) path.push([lon0, lat0 + 0.0005 * i]);
  const slowEverywhere = path.map(() => 1.0);
  const fastEverywhere = path.map(() => 8.0);
  // Bus stops of route "183" every ~390 m along the whole path, right on it.
  const lineStops = (ref: string, everyPts = 7, offLon = 0): TransitStop[] => {
    const out: TransitStop[] = [];
    for (let i = 0; i < path.length; i += everyPts) {
      out.push({ id: 1000 + i, lat: path[i]![1], lon: path[i]![0] + offLon, busStop: true, routeRef: ref });
    }
    return out;
  };

  it('one line hugging the whole trace with dwells → bus (3 votes)', () => {
    const r = classifyBusCorridor({ path, speeds: slowEverywhere, stops: lineStops('183') });
    expect(r?.mode).toBe('bus');
    expect(r?.modeSource).toBe('corridor');
    expect(r?.modeConfidence).toBe(0.8);
  });

  it('full corridor but no dwells → null (a car commuting along a bus line)', () => {
    // count+span alone only prove the STREET carries a bus line, not that the
    // vehicle behaved like a bus. Real case (2026-07-03, line 187 to Cachan):
    // a daily car commute matched 14 stops with span 0.94 and was classified
    // bus on count+span. Dwell — slowing at the stops a bus must serve — is
    // now mandatory evidence. Known cost: a power-save ride whose GPS is too
    // thin to ever catch a stop dwell is no longer auto-detected.
    const r = classifyBusCorridor({ path, speeds: fastEverywhere, stops: lineStops('183') });
    expect(r).toBeNull();
  });

  it('dwells at stops plus full span but low count → bus (dwell + 1)', () => {
    // Sparse-line corridor: only 6 matched stops (count vote fails) but the
    // trace demonstrably serves them (dwell) across most of the path (span).
    const stops = lineStops('183', 17); // ~6 stops over 5.5 km
    const r = classifyBusCorridor({ path, speeds: slowEverywhere, stops });
    expect(r?.mode).toBe('bus');
    expect(r?.modeConfidence).toBe(0.6);
  });

  it('endpoint-shared ref counts as the structural vote behind dwell', () => {
    // Short anchored hop: 3 matched stops clustered mid-path (count and span
    // both fail) but the ride dwells at them and both endpoints sit on the
    // line — the endpoint ref supplies the structural vote.
    const shortPath = path.slice(0, 20); // ~1.1 km
    const slow = shortPath.map(() => 1.0);
    const stops: TransitStop[] = [8, 10, 12].map((i) => ({
      id: 3000 + i, lat: shortPath[i]![1], lon: shortPath[i]![0], busStop: true, routeRef: '38',
    }));
    const withRef = classifyBusCorridor({
      path: shortPath, speeds: slow, stops, endpointRefs: new Set(['38']),
    });
    expect(withRef?.mode).toBe('bus');
    expect(withRef?.modeConfidence).toBe(0.6);
    // Same evidence without the endpoint anchor: no structural vote → null.
    expect(classifyBusCorridor({ path: shortPath, speeds: slow, stops })).toBeNull();
    // Endpoint anchor without dwell (the June car commutes): null.
    const fast = shortPath.map(() => 8.0);
    expect(
      classifyBusCorridor({ path: shortPath, speeds: fast, stops, endpointRefs: new Set(['38']) })
    ).toBeNull();
  });

  it('few stops over a small part of the trace → null (car crossing a line)', () => {
    // 5 stops clustered on the first fifth of the path, no dwells.
    const stops = lineStops('62').slice(0, 5).map((s, i) => ({ ...s, lat: path[i * 2]![1], lon: path[i * 2]![0] }));
    expect(classifyBusCorridor({ path, speeds: fastEverywhere, stops })).toBeNull();
  });

  it('stops far from the polyline never vote', () => {
    // Same line but shifted ~800 m east of the path.
    const r = classifyBusCorridor({ path, speeds: slowEverywhere, stops: lineStops('183', 7, 0.011) });
    expect(r).toBeNull();
  });

  it('non-bus stops and refless stops are ignored', () => {
    const rail: TransitStop[] = path
      .filter((_, i) => i % 7 === 0)
      .map((c, i) => ({ id: i, lat: c[1], lon: c[0], busStop: false, routeRef: 'C', railway: 'station' }));
    expect(classifyBusCorridor({ path, speeds: slowEverywhere, stops: rail })).toBeNull();
  });

  it('degenerate paths return null', () => {
    expect(classifyBusCorridor({ path: [], speeds: [], stops: [] })).toBeNull();
    expect(classifyBusCorridor({ path: [[lon0, lat0]], speeds: [null], stops: [] })).toBeNull();
  });

  it('a trace that doubles back over the same corridor is not a bus (coach/car doing a loop)', () => {
    // Real case (2026-07-03): a coach ride went south, back north, then south
    // again along the same avenue lined with one route's stops — span and
    // dwell both voted, classifying it as a bus. A scheduled bus progresses
    // along its route ONCE; it never passes the same stops two or three times.
    // Out-and-back-and-out over a ~2.2 km corridor: up 40 steps, down 20,
    // up 30 (~5 km of path over a 2.2 km extent).
    const zigzag: Array<[number, number]> = [];
    const at = (i: number): [number, number] => [lon0, lat0 + 0.0005 * i];
    for (let i = 0; i <= 40; i++) zigzag.push(at(i));
    for (let i = 39; i >= 20; i--) zigzag.push(at(i));
    for (let i = 21; i <= 50; i++) zigzag.push(at(i));
    // One route's stops every ~390 m along the corridor extent.
    const stops: TransitStop[] = [];
    for (let i = 0; i <= 50; i += 7) {
      stops.push({ id: 2000 + i, lat: lat0 + 0.0005 * i, lon: lon0, busStop: true, routeRef: '192' });
    }
    const slow = zigzag.map(() => 1.0);
    expect(classifyBusCorridor({ path: zigzag, speeds: slow, stops })).toBeNull();
  });
});
