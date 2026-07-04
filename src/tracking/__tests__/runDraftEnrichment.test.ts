import type { QueryClient } from '@tanstack/react-query';
import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import { insertTripWithSections, getTripById } from '../../db/trips';
import {
  runDraftEnrichment,
  _resetDraftEnrichmentStateForTests,
} from '../refreshDrafts';
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
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [
      { ordering: 0, startTimeMs: 0, endTimeMs: 600_000, mode: 'car', distanceM: 5000, durationS: 600, avgSpeedMps: 8.3, maxSpeedMps: 30, co2G: 1090, geojson: gj },
    ],
    breaks: [],
  };
}

function fakeQueryClient(): { qc: QueryClient; invalidations: string[] } {
  const invalidations: string[] = [];
  const qc = {
    invalidateQueries: async (opts: { queryKey: unknown[] }) => {
      invalidations.push(String(opts.queryKey[0]));
    },
  } as unknown as QueryClient;
  return { qc, invalidations };
}

function emptyOverpassDeps(
  db: OverpassDeps['db'],
  cacheDb: OverpassDeps['db'],
  opts: { status?: number; gate?: () => Promise<void> } = {}
): { deps: OverpassDeps; calls: () => number } {
  let calls = 0;
  const deps: OverpassDeps = {
    db,
    cacheDb: async () => cacheDb,
    minIntervalMs: 0,
    nowMs: () => 1,
    fetchFn: async () => {
      calls++;
      await opts.gate?.();
      return {
        status: opts.status ?? 200,
        ok: (opts.status ?? 200) === 200,
        json: async () => ({ elements: [] }),
      } as unknown as Response;
    },
  };
  return { deps, calls: () => calls };
}

async function setup() {
  const db = createMockDb();
  await runMigrations(db);
  const cacheDb = createMockDb();
  await ensureTransitCacheSchema(cacheDb);
  return { db, cacheDb };
}

describe('runDraftEnrichment', () => {
  beforeEach(() => _resetDraftEnrichmentStateForTests());

  it('clears drafts and invalidates trip queries along the way', async () => {
    const { db, cacheDb } = await setup();
    const tripId = await insertTripWithSections(db, draftCarTrip());
    const { qc, invalidations } = fakeQueryClient();
    const { deps } = emptyOverpassDeps(db, cacheDb);

    const res = await runDraftEnrichment(db, qc, deps);

    expect(res.enriched).toBe(1);
    const trip = await getTripById(db, tripId);
    expect(trip!.draft).toBe(false);
    expect(invalidations).toContain('trips');
    expect(invalidations).toContain('stats');
  });

  it('is single-flight: a kick during an active pass shares its promise', async () => {
    const { db, cacheDb } = await setup();
    await insertTripWithSections(db, draftCarTrip());
    const { qc } = fakeQueryClient();

    let release!: () => void;
    const gatePromise = new Promise<void>((r) => (release = r));
    const { deps, calls } = emptyOverpassDeps(db, cacheDb, { gate: () => gatePromise });

    const first = runDraftEnrichment(db, qc, deps);
    const second = runDraftEnrichment(db, qc, deps);
    expect(second).toBe(first);

    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(r2);
    // The follow-up pass requested by the second kick finds no drafts left, so
    // fetch counts stay bounded (no concurrent duplicate enrichment).
    expect(calls()).toBeGreaterThan(0);
  });

  it('backs off after a rate-limit: the next kick is refused without network', async () => {
    const { db, cacheDb } = await setup();
    const tripId = await insertTripWithSections(db, draftCarTrip());
    const { qc } = fakeQueryClient();
    const { deps, calls } = emptyOverpassDeps(db, cacheDb, { status: 429 });

    const first = await runDraftEnrichment(db, qc, deps);
    expect(first.rateLimited).toBe(true);
    const callsAfterFirst = calls();

    const second = await runDraftEnrichment(db, qc, deps);
    expect(second).toEqual({ enriched: 0, rateLimited: true });
    expect(calls()).toBe(callsAfterFirst); // no new network traffic
    const trip = await getTripById(db, tripId);
    expect(trip!.draft).toBe(true);
    expect(trip!.draftReason).toBe('rate_limited');
  });
});
