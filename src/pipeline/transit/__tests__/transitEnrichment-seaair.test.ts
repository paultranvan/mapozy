import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { ensureTransitCacheSchema } from '../../../db/transitCacheDb';
import { insertTripWithSections, getTripById } from '../../../db/trips';
import { insertRawPoint } from '../../../db/rawPoints';
import { enrichTripTransit } from '../transitEnrichment';
import type { OverpassDeps } from '../../../lib/overpass';
import type { Mode, Trip } from '../../../types';

function fakeResponse(body: unknown) {
  return { status: 200, ok: true, json: async () => body } as unknown as Response;
}

function oneSectionTrip(
  mode: Mode,
  coords: Array<[number, number]>,
  distanceM: number,
  durationS: number
): Trip {
  const geojson = JSON.stringify({ type: 'LineString', coordinates: coords });
  return {
    startTimeMs: 0,
    endTimeMs: durationS * 1000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM,
    durationS,
    dominantMode: mode,
    co2G: 0,
    geojson,
    manualPurpose: null,
    draft: true,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [
      {
        ordering: 0,
        startTimeMs: 0,
        endTimeMs: durationS * 1000,
        mode,
        distanceM,
        durationS,
        avgSpeedMps: distanceM / durationS,
        maxSpeedMps: distanceM / durationS,
        co2G: 0,
        geojson,
      },
    ],
    breaks: [],
  };
}

async function depsWith(fetchFn: OverpassDeps['fetchFn']): Promise<OverpassDeps> {
  const db = createMockDb();
  await runMigrations(db);
  const cacheDb = createMockDb();
  await ensureTransitCacheSchema(cacheDb);
  return { db, cacheDb: async () => cacheDb, fetchFn, nowMs: () => 1_000_000, minIntervalMs: 0 };
}

async function insertFix(deps: OverpassDeps, t: number, lat: number, lon: number) {
  await insertRawPoint(deps.db, {
    timestampMs: t,
    latitude: lat,
    longitude: lon,
    altitude: null,
    accuracyMeters: 8,
    speedMps: null,
    bearingDeg: null,
    batteryLevel: null,
    isCharging: false,
  });
}

function queryOf(init: unknown): string {
  return decodeURIComponent(String((init as RequestInit).body ?? ''));
}

describe('enrichTripTransit — RULE_FLIGHT_AIRPORTS', () => {
  // Departure gate A, arrival runway B ~337 km north: a 3 h hole between the
  // last fix at the gate and the first one after landing (≈ 112 km/h).
  const A: [number, number] = [120.0, 12.0];
  const B: [number, number] = [120.5, 15.0];
  const HOLE_MS = 3 * 3600_000;

  // Airport ground at whichever of the two ends is listed.
  function airportFetch(ends: Array<[number, number]>, seen: string[] = []): OverpassDeps['fetchFn'] {
    return async (_url, init) => {
      const q = queryOf(init);
      seen.push(q);
      if (!q.includes('"aeroway"')) return fakeResponse({ elements: [] });
      return fakeResponse({
        elements: ends.map(([lon, lat], i) => ({
          type: 'way',
          id: 100 + i,
          tags: { aeroway: 'runway' },
          geometry: [
            { lat, lon: lon - 0.005 },
            { lat, lon: lon + 0.005 },
          ],
        })),
      });
    };
  }

  // A section holding the hole, then `afterMin` minutes of fixes at B.
  async function holeTrip(deps: OverpassDeps, afterMin: number) {
    const durationS = HOLE_MS / 1000 + afterMin * 60;
    const id = await insertTripWithSections(
      deps.db,
      oneSectionTrip('car', [A, B], 337_000, durationS)
    );
    await insertFix(deps, 0, A[1], A[0]);
    for (let m = 0; m <= afterMin; m += 5) {
      await insertFix(deps, HOLE_MS + m * 60_000, B[1], B[0] + m * 0.00001);
    }
    return id;
  }

  it('turns a fix-less hop between two airports into a plane section', async () => {
    const deps = await depsWith(airportFetch([A, B]));
    const id = await holeTrip(deps, 15);

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('enriched');
    expect(res.changed).toBe(1);
    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('plane');
    expect(t!.sections[0]!.modeSource).toBe('station');
    expect(t!.dominantMode).toBe('plane');
    expect(t!.draft).toBe(false);
  });

  it('leaves the hop alone when only one end is at an airport', async () => {
    const deps = await depsWith(airportFetch([A]));
    const id = await holeTrip(deps, 15);

    await enrichTripTransit(deps, id);
    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('car');
  });

  it('leaves a section alone when a long drive follows the hop inside it', async () => {
    // 2 h of fixes after landing: more than a taxi-in, so the section is not
    // gate-to-gate and is not turned into a flight wholesale.
    const seen: string[] = [];
    const deps = await depsWith(airportFetch([A, B], seen));
    const id = await holeTrip(deps, 120);

    await enrichTripTransit(deps, id);
    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('car');
    expect(seen.some((q) => q.includes('"aeroway"'))).toBe(false);
  });

  it('never looks airports up for a section with no long hop', async () => {
    const seen: string[] = [];
    const deps = await depsWith(airportFetch([A, B], seen));
    const id = await insertTripWithSections(
      deps.db,
      oneSectionTrip('car', [A, [120.0, 12.05]], 5500, 600)
    );

    await enrichTripTransit(deps, id);
    expect(seen.some((q) => q.includes('"aeroway"'))).toBe(false);
  });
});

describe('enrichTripTransit — RULE_OPEN_WATER', () => {
  // Mainland coast running north along lon 5.02 (land to the west), one tile.
  const coastFetch = (seen: string[] = []): OverpassDeps['fetchFn'] => async (_url, init) => {
    const q = queryOf(init);
    seen.push(q);
    if (!q.includes('"coastline"')) return fakeResponse({ elements: [] });
    return fakeResponse({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { natural: 'coastline' },
          geometry: Array.from({ length: 11 }, (_, i) => ({ lat: 45.0 + i * 0.005, lon: 5.02 })),
        },
      ],
    });
  };

  // ~4.4 km heading north at the given longitude, a point every ~110 m.
  function northbound(lon: number): Array<[number, number]> {
    return Array.from({ length: 41 }, (_, i) => [lon, 45.005 + i * 0.001] as [number, number]);
  }

  it('turns a walking-pace section lying at sea into a boat section', async () => {
    const deps = await depsWith(coastFetch());
    // 800 m off the coast, 4.4 km in an hour: 1.2 m/s, labelled walk.
    const id = await insertTripWithSections(
      deps.db,
      oneSectionTrip('walk', northbound(5.03), 4400, 3600)
    );

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('enriched');
    expect(res.changed).toBe(1);
    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('boat');
    expect(t!.sections[0]!.modeSource).toBe('watermatch');
    expect(t!.dominantMode).toBe('boat');
  });

  it('leaves the same walk alone on the land side of the coast', async () => {
    const deps = await depsWith(coastFetch());
    const id = await insertTripWithSections(
      deps.db,
      oneSectionTrip('walk', northbound(5.01), 4400, 3600)
    );

    const res = await enrichTripTransit(deps, id);
    expect(res.changed).toBe(0);
    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('walk');
  });

  it('respects a mode the user set by hand', async () => {
    const deps = await depsWith(coastFetch());
    const trip = oneSectionTrip('walk', northbound(5.03), 4400, 3600);
    trip.sections[0]!.userMode = 'run';
    const id = await insertTripWithSections(deps.db, trip);

    const res = await enrichTripTransit(deps, id);
    expect(res.changed).toBe(0);
  });

  it('never fetches the coast for a short or fast section', async () => {
    const seen: string[] = [];
    const deps = await depsWith(coastFetch(seen));
    // A 500 m stroll, and a 4.4 km bike section at 12 m/s.
    const stroll = await insertTripWithSections(
      deps.db,
      oneSectionTrip('walk', northbound(5.03).slice(0, 5), 500, 400)
    );
    const fast = await insertTripWithSections(
      deps.db,
      oneSectionTrip('bike', northbound(5.03), 4400, 360)
    );

    await enrichTripTransit(deps, stroll);
    await enrichTripTransit(deps, fast);
    expect(seen.some((q) => q.includes('"coastline"'))).toBe(false);
  });
});
