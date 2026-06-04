import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { insertTripWithSections, getTripById } from '../../../db/trips';
import { enrichTripTransit } from '../transitEnrichment';
import type { OverpassDeps } from '../../../lib/overpass';
import type { Trip } from '../../../types';

const lat0 = 45.0;
const lonA = 5.0;
const lonB = 5.02; // ~1.6 km east — clearly travel

// walk to station A | gap break | walk from station B
function subwayGapTrip(): Trip {
  const walkA = [[lonA, lat0], [lonA, lat0 + 0.0003]] as Array<[number, number]>;
  const walkB = [[lonB, lat0], [lonB, lat0 + 0.0003]] as Array<[number, number]>;
  const mk = (ordering: number, coords: Array<[number, number]>) => ({
    ordering,
    startTimeMs: ordering === 0 ? 0 : 700_000,
    endTimeMs: ordering === 0 ? 60_000 : 760_000,
    mode: 'walk' as const,
    distanceM: 30,
    durationS: 60,
    avgSpeedMps: 0.5,
    maxSpeedMps: 0.6,
    co2G: 0,
    geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
  });
  return {
    startTimeMs: 0,
    endTimeMs: 760_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 60,
    durationS: 760,
    dominantMode: 'walk',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    createdAtMs: 0,
    sections: [mk(0, walkA), mk(1, walkB)],
    // gap break between the two walks (10 min underground)
    breaks: [{ ordering: 0, startTimeMs: 60_000, endTimeMs: 660_000, centerLat: lat0, centerLon: lonA, gap: true }],
  };
}

function fakeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  return { status: init.status ?? 200, ok: init.ok ?? true, json: async () => body } as unknown as Response;
}

// Stops query returns a subway station node near whatever point is queried; ways empty.
function metroFetch(): OverpassDeps['fetchFn'] {
  return async (_url, init) => {
    const body = String((init as RequestInit).body ?? '');
    if (body.includes('way%5B%22railway') || body.includes('way["railway')) {
      return fakeResponse({ elements: [] });
    }
    // crude: return a subway station at the bbox's SW-ish corner; both endpoints
    // are inside their own padded cells so each gets a near station.
    return fakeResponse({
      elements: [
        { type: 'node', id: 1, lat: lat0, lon: lonA, tags: { railway: 'subway_entrance' } },
        { type: 'node', id: 2, lat: lat0, lon: lonB, tags: { railway: 'subway_entrance' } },
      ],
    });
  };
}

async function depsWith(fetchFn: OverpassDeps['fetchFn']) {
  const db = createMockDb();
  await runMigrations(db);
  return { db, fetchFn, nowMs: () => 1_000_000, minIntervalMs: 0 } as OverpassDeps;
}

describe('enrichTripTransit — subway gap', () => {
  it('converts a metro-to-metro gap break into a subway section', async () => {
    const deps = await depsWith(metroFetch());
    const id = await insertTripWithSections(deps.db, subwayGapTrip());

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('enriched');

    const t = await getTripById(deps.db, id);
    expect(t!.sections.map((s) => s.mode)).toEqual(['walk', 'subway', 'walk']);
    expect(t!.sections[1]!.modeSource).toBe('gap');
    expect(t!.breaks).toHaveLength(0);
    expect(t!.dominantMode).toBe('subway');
    expect(t!.draft).toBe(false);
  });

  it('leaves the break alone when endpoints are not near a metro station', async () => {
    const noStops: OverpassDeps['fetchFn'] = async () => fakeResponse({ elements: [] });
    const deps = await depsWith(noStops);
    const id = await insertTripWithSections(deps.db, subwayGapTrip());

    await enrichTripTransit(deps, id);
    const t = await getTripById(deps.db, id);
    expect(t!.sections.map((s) => s.mode)).toEqual(['walk', 'walk']);
    expect(t!.breaks).toHaveLength(1);
    expect(t!.breaks[0]!.gap).toBe(true);
  });
});
