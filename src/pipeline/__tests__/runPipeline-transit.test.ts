import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import { runPipeline } from '../runPipeline';
import { listTrips } from '../../db/trips';
import { syntheticTrip } from './_fixtures';
import { insertRawPoint } from '../../db/rawPoints';
import { insertRawActivity } from '../../db/rawActivities';
import { refreshDraftTrips } from '../../tracking/refreshDrafts';
import type { OverpassDeps } from '../../lib/overpass';

function fakeResponse(body: unknown) {
  return { status: 200, ok: true, json: async () => body } as unknown as Response;
}

// Return a rail way covering the synthetic trip's drive leg (north segment at
// lon 5.0024, lat 45.0 → 45.018), empty stops.
function railFetch(): OverpassDeps['fetchFn'] {
  return async (_url, init) => {
    const body = String((init as RequestInit).body ?? '');
    if (body.includes('way%5B%22railway') || body.includes('way["railway')) {
      return fakeResponse({
        elements: [
          {
            type: 'way',
            id: 1,
            tags: { railway: 'rail' },
            geometry: [
              { lat: 45.0, lon: 5.0024 },
              { lat: 45.018, lon: 5.0024 },
            ],
          },
        ],
      });
    }
    return fakeResponse({ elements: [] });
  };
}

async function seed(db: ReturnType<typeof createMockDb>) {
  const { points, activities } = syntheticTrip();
  for (const p of points) await insertRawPoint(db, p);
  for (const a of activities) await insertRawActivity(db, a);
  const maxTs = points[points.length - 1]!.timestampMs;
  return { upToMs: maxTs + 1, nowMs: maxTs };
}

describe('runPipeline transit enrichment (opt-in)', () => {
  it('without a transit dep, the drive stays car (offline default)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const opts = await seed(db);

    await runPipeline(db, opts);
    const [trip] = await listTrips(db, 10, 0);
    // listTrips returns trips without sections; re-read via the drive's dominant.
    expect(trip!.dominantMode).toBe('car');
    expect(trip!.draft).toBe(false);
  });

  it('with a transit dep, the run stays local: trip lands as a pending draft', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const opts = await seed(db);

    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    let fetches = 0;
    const countingFetch: OverpassDeps['fetchFn'] = async (url, init) => {
      fetches++;
      return railFetch()!(url, init);
    };
    const res = await runPipeline(db, {
      ...opts,
      transit: { db, cacheDb: async () => cacheDb, fetchFn: countingFetch, nowMs: () => 1_000_000, minIntervalMs: 0 },
    });

    // Enrichment is a separate background pass now — the run itself must not
    // touch the network, and must surface the draft for that pass to pick up.
    expect(fetches).toBe(0);
    const [trip] = await listTrips(db, 10, 0);
    expect(trip!.dominantMode).toBe('car');
    expect(trip!.draft).toBe(true);
    expect(res.pendingEnrichmentTripIds).toEqual([trip!.id]);
  });

  it('run + draft pass: the drive becomes train end-to-end', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const opts = await seed(db);

    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const transit: OverpassDeps = {
      db,
      cacheDb: async () => cacheDb,
      fetchFn: railFetch(),
      nowMs: () => 1_000_000,
      minIntervalMs: 0,
    };
    await runPipeline(db, { ...opts, transit });
    const er = await refreshDraftTrips(db, transit);

    expect(er.enriched).toBe(1);
    const [trip] = await listTrips(db, 10, 0);
    expect(trip!.dominantMode).toBe('train');
    expect(trip!.draft).toBe(false);
  });
});
