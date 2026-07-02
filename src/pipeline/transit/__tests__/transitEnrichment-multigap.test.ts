import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { ensureTransitCacheSchema } from '../../../db/transitCacheDb';
import { insertTripWithSections, getTripById } from '../../../db/trips';
import { enrichTripTransit } from '../transitEnrichment';
import type { OverpassDeps } from '../../../lib/overpass';
import type { Trip } from '../../../types';

const lat0 = 45.0;
const lonA = 5.0;
const lonB = 5.02; // ~1.6 km east
const lonC = 5.04; // ~1.6 km further east

// walk A | gap | walk B | gap | walk C — a bus ride power-saved into two gaps.
function twoGapTrip(): Trip {
  const walk = (lon: number) =>
    [[lon, lat0], [lon, lat0 + 0.0003]] as Array<[number, number]>;
  const mk = (ordering: number, lon: number, t: number) => ({
    ordering,
    startTimeMs: t,
    endTimeMs: t + 60_000,
    mode: 'walk' as const,
    distanceM: 30,
    durationS: 60,
    avgSpeedMps: 0.5,
    maxSpeedMps: 0.6,
    co2G: 0,
    geojson: JSON.stringify({ type: 'LineString', coordinates: walk(lon) }),
  });
  return {
    startTimeMs: 0,
    endTimeMs: 1_460_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 90,
    durationS: 1460,
    dominantMode: 'walk',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [mk(0, lonA, 0), mk(1, lonB, 700_000), mk(2, lonC, 1_400_000)],
    breaks: [
      { ordering: 0, startTimeMs: 60_000, endTimeMs: 660_000, centerLat: lat0, centerLon: lonA, gap: true },
      { ordering: 1, startTimeMs: 760_000, endTimeMs: 1_360_000, centerLat: lat0, centerLon: lonB, gap: true },
    ],
  };
}

function fakeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  return { status: init.status ?? 200, ok: init.ok ?? true, json: async () => body } as unknown as Response;
}

// Returns a subway station at each of the three lons; ways empty.
function metroFetch(): OverpassDeps['fetchFn'] {
  return async (_url, init) => {
    const body = String((init as RequestInit).body ?? '');
    if (body.includes('way%5B%22railway') || body.includes('way["railway')) {
      return fakeResponse({ elements: [] });
    }
    return fakeResponse({
      elements: [
        { type: 'node', id: 1, lat: lat0, lon: lonA, tags: { railway: 'subway_entrance' } },
        { type: 'node', id: 2, lat: lat0, lon: lonB, tags: { railway: 'subway_entrance' } },
        { type: 'node', id: 3, lat: lat0, lon: lonC, tags: { railway: 'subway_entrance' } },
      ],
    });
  };
}

async function depsWith(fetchFn: OverpassDeps['fetchFn']) {
  const db = createMockDb();
  await runMigrations(db);
  const cacheDb = createMockDb();
  await ensureTransitCacheSchema(cacheDb);
  return { db, cacheDb: async () => cacheDb, fetchFn, nowMs: () => 1_000_000, minIntervalMs: 0 } as OverpassDeps;
}

describe('enrichTripTransit — multiple subway gaps in one trip', () => {
  it('does NOT fabricate a subway chain when two gaps both qualify', async () => {
    const deps = await depsWith(metroFetch());
    const id = await insertTripWithSections(deps.db, twoGapTrip());

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('enriched');

    const t = await getTripById(deps.db, id);
    // Stays three walks with two gap breaks — no fabricated subway teleports.
    expect(t!.sections.map((s) => s.mode)).toEqual(['walk', 'walk', 'walk']);
    expect(t!.breaks).toHaveLength(2);
    expect(t!.breaks.every((b) => b.gap)).toBe(true);
    expect(t!.dominantMode).toBe('walk');
  });
});
