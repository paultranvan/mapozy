import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import { insertTripWithSections, getTripById } from '../../db/trips';
import {
  refreshDraftTrips,
  TRIP_RETRY_BASE_MS,
  _resetDraftEnrichmentStateForTests,
} from '../refreshDrafts';
import type { OverpassDeps } from '../../lib/overpass';
import type { Trip } from '../../types';

const lat0 = 45.0;
const lon0 = 5.0;

beforeEach(() => _resetDraftEnrichmentStateForTests());

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
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const deps: OverpassDeps = { db, cacheDb: async () => cacheDb, fetchFn: railFetch(), nowMs: () => 1_000_000, minIntervalMs: 0 };

    const res = await refreshDraftTrips(db, deps);
    expect(res.enriched).toBe(1);
    expect(res.rateLimited).toBe(false);
  });

  it('reports rateLimited when Overpass 429s', async () => {
    const db = await mkDb();
    const id = await insertTripWithSections(db, draftCarTrip());
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const deps: OverpassDeps = { db, cacheDb: async () => cacheDb, fetchFn: async () => fakeResponse({}, { status: 429, ok: false }), nowMs: () => 1_000_000, minIntervalMs: 0 };

    const res = await refreshDraftTrips(db, deps);
    expect(res.rateLimited).toBe(true);
    expect(res.enriched).toBe(0);
    const t = await getTripById(db, id);
    expect(t!.draft).toBe(true);
    expect(t!.draftReason).toBe('rate_limited');
  });

  it('is a no-op with no drafts', async () => {
    const db = await mkDb();
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const deps: OverpassDeps = { db, cacheDb: async () => cacheDb, fetchFn: railFetch(), nowMs: () => 1_000_000, minIntervalMs: 0 };
    const res = await refreshDraftTrips(db, deps);
    expect(res).toEqual({ enriched: 0, rateLimited: false });
  });
});

describe('refreshDraftTrips — per-trip retry backoff', () => {
  // A trip whose enrichment failed must NOT be retried by the very next pass
  // (it would re-pay its whole Overpass cost and starve the rest of the
  // queue, as the 641 km trip of the 2026-07-14 export did for days); it
  // becomes eligible again once its backoff expires.
  function failingArea(): Trip {
    // Around lat 45.5 — its rail-query bbox contains "45.4", the fetch mock's
    // failure marker.
    const coords: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) coords.push([lon0, 45.499 + 0.0005 * i]);
    const gj = JSON.stringify({ type: 'LineString', coordinates: coords });
    const t = draftCarTrip();
    return { ...t, startTimeMs: 1_000, endTimeMs: 601_000, geojson: gj, sections: [{ ...t.sections[0]!, startTimeMs: 1_000, endTimeMs: 601_000, geojson: gj }] };
  }

  async function mkFailableDeps(db: Awaited<ReturnType<typeof mkDb>>, now: () => number) {
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const state = { failRail: true };
    const fetchFn: OverpassDeps['fetchFn'] = async (_url, init) => {
      const body = decodeURIComponent(String((init as RequestInit).body ?? ''));
      if (state.failRail && body.includes('way["railway') && body.includes('45.4')) {
        return fakeResponse({}, { status: 500, ok: false });
      }
      return fakeResponse({ elements: [] });
    };
    const deps = { db, cacheDb: async () => cacheDb, fetchFn, nowMs: now, minIntervalMs: 0 } as OverpassDeps;
    return { deps, state };
  }

  it('skips a just-failed trip on the next pass but still processes others', async () => {
    const db = await mkDb();
    let now = 1_000_000;
    const { deps, state } = await mkFailableDeps(db, () => now);
    const failing = await insertTripWithSections(db, failingArea());
    const ok = await insertTripWithSections(db, draftCarTrip());

    // Pass 1: the failing trip errors (drafted overpass_error), the other enriches.
    const r1 = await refreshDraftTrips(db, deps);
    expect(r1.enriched).toBe(1);
    expect((await getTripById(db, failing))!.draftReason).toBe('overpass_error');
    expect((await getTripById(db, ok))!.draft).toBe(false);

    // Pass 2, right away: the failed trip is in backoff — not retried.
    now += 1_000;
    const r2 = await refreshDraftTrips(db, deps);
    expect(r2.enriched).toBe(0);
    expect((await getTripById(db, failing))!.draft).toBe(true);

    // Pass 3, after the backoff: retried (and the area now responds).
    state.failRail = false;
    now += TRIP_RETRY_BASE_MS;
    const r3 = await refreshDraftTrips(db, deps);
    expect(r3.enriched).toBe(1);
    expect((await getTripById(db, failing))!.draft).toBe(false);
  });
});
