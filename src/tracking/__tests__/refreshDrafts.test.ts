import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { insertTripWithSections, getTripById } from '../../db/trips';
import { refreshDraftTrips } from '../refreshDrafts';
import type { OverpassDeps } from '../../lib/overpass';
import type { Trip } from '../../types';

const lat0 = 45.0;
const lon0 = 5.0;

function draftCarTrip(): Trip {
  const coords: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) coords.push([lon0, lat0 + 0.0005 * i]);
  const gj = JSON.stringify({ type: 'LineString', coordinates: coords });
  return {
    startTimeMs: 0,
    endTimeMs: 600_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 5000,
    durationS: 600,
    dominantMode: 'car',
    co2G: 1090,
    geojson: gj,
    manualPurpose: null,
    draft: true,
    draftReason: 'offline',
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [
      { ordering: 0, startTimeMs: 0, endTimeMs: 600_000, mode: 'car', distanceM: 5000, durationS: 600, avgSpeedMps: 8.3, maxSpeedMps: 30, co2G: 1090, geojson: gj },
    ],
    breaks: [],
  };
}

function fakeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  return { status: init.status ?? 200, ok: init.ok ?? true, json: async () => body } as unknown as Response;
}
function railFetch(): OverpassDeps['fetchFn'] {
  return async (_url, init) => {
    const body = String((init as RequestInit).body ?? '');
    if (body.includes('way%5B%22railway') || body.includes('way["railway')) {
      return fakeResponse({ elements: [ { type: 'way', id: 1, tags: { railway: 'rail' }, geometry: [ { lat: lat0, lon: lon0 }, { lat: lat0 + 0.0045, lon: lon0 } ] } ] });
    }
    return fakeResponse({ elements: [] });
  };
}

async function mkDb() {
  const db = createMockDb();
  await runMigrations(db);
  return db;
}

describe('refreshDraftTrips', () => {
  it('re-enriches drafts and reports the count', async () => {
    const db = await mkDb();
    await insertTripWithSections(db, draftCarTrip());
    const deps: OverpassDeps = { db, fetchFn: railFetch(), nowMs: () => 1_000_000, minIntervalMs: 0 };

    const res = await refreshDraftTrips(db, deps);
    expect(res.enriched).toBe(1);
    expect(res.rateLimited).toBe(false);
  });

  it('reports rateLimited when Overpass 429s', async () => {
    const db = await mkDb();
    const id = await insertTripWithSections(db, draftCarTrip());
    const deps: OverpassDeps = { db, fetchFn: async () => fakeResponse({}, { status: 429, ok: false }), nowMs: () => 1_000_000, minIntervalMs: 0 };

    const res = await refreshDraftTrips(db, deps);
    expect(res.rateLimited).toBe(true);
    expect(res.enriched).toBe(0);
    const t = await getTripById(db, id);
    expect(t!.draft).toBe(true);
    expect(t!.draftReason).toBe('rate_limited');
  });

  it('is a no-op with no drafts', async () => {
    const db = await mkDb();
    const deps: OverpassDeps = { db, fetchFn: railFetch(), nowMs: () => 1_000_000, minIntervalMs: 0 };
    const res = await refreshDraftTrips(db, deps);
    expect(res).toEqual({ enriched: 0, rateLimited: false });
  });
});
