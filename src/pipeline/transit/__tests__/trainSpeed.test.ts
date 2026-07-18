import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { ensureTransitCacheSchema } from '../../../db/transitCacheDb';
import { insertTripWithSections, getTripById } from '../../../db/trips';
import { enrichTripTransit } from '../transitEnrichment';
import { classifyTrainBySpeed } from '../classifySection';
import type { OverpassDeps } from '../../../lib/overpass';
import type { Trip } from '../../../types';

describe('classifyTrainBySpeed (RULE_TRAIN_SPEED)', () => {
  it('classifies a long very fast section as train without any network', () => {
    // Trip 97 of the 2026-07-14 export: 305.6 km in 5280 s ≈ 207 km/h — no
    // road vehicle sustains that; only rail does.
    const cls = classifyTrainBySpeed(305_600, 5280);
    expect(cls).toEqual({ mode: 'train', modeSource: 'speed', modeConfidence: 0.85 });
  });

  it('leaves motorway-speed sections alone (car can average this)', () => {
    // 178.7 km at ~110 km/h — an ordinary motorway drive.
    expect(classifyTrainBySpeed(178_700, 5820)).toBeNull();
  });

  it('ignores short fast bursts (GPS glitch cannot prove train)', () => {
    // 2 km at 200 km/h: a single spiky fix pair, not a ride.
    expect(classifyTrainBySpeed(2_000, 36)).toBeNull();
  });
});

describe('enrichTripTransit — speed-classified train', () => {
  const lat0 = 48.6;
  const lon0 = 2.1;

  function tgvTrip(): Trip {
    // Sparse fixes along a ~300 km diagonal (power-save leaves few raw points).
    const coords: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) coords.push([lon0 + i * 0.3, lat0 + i * 0.15]);
    const gj = JSON.stringify({ type: 'LineString', coordinates: coords });
    return {
      startTimeMs: 0,
      endTimeMs: 5_280_000,
      startPlaceId: null,
      endPlaceId: null,
      distanceM: 305_600,
      durationS: 5280,
      dominantMode: 'car',
      co2G: 0,
      geojson: gj,
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
          endTimeMs: 5_280_000,
          mode: 'car',
          distanceM: 305_600,
          durationS: 5280,
          avgSpeedMps: 57.9,
          maxSpeedMps: 85,
          co2G: 0,
          geojson: gj,
        },
      ],
      breaks: [],
    };
  }

  it('classifies by speed with ZERO Overpass/Valhalla calls', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    let fetchCalls = 0;
    const deps: OverpassDeps = {
      db,
      cacheDb: async () => cacheDb,
      fetchFn: async () => {
        fetchCalls++;
        return { status: 200, ok: true, json: async () => ({ elements: [] }) } as unknown as Response;
      },
      nowMs: () => 1_000_000,
      minIntervalMs: 0,
    };
    const id = await insertTripWithSections(db, tgvTrip());

    const res = await enrichTripTransit(deps, id);

    expect(res.status).toBe('enriched');
    expect(fetchCalls).toBe(0);
    const t = await getTripById(db, id);
    expect(t!.draft).toBe(false);
    expect(t!.sections[0]!.mode).toBe('train');
    expect(t!.sections[0]!.modeSource).toBe('speed');
    expect(t!.dominantMode).toBe('train');
  });

  it('bounds rail probing to the tile budget on long motorway-speed sections', async () => {
    // ~110 km/h average: below the train-speed floor, so the section still
    // goes through rail map-matching — but over 50 tiles the probe must be
    // subsampled to RULE_RAIL_MAP_MATCH.maxProbeTiles, not fetch them all.
    const coords: Array<[number, number]> = Array.from(
      { length: 50 },
      (_, i) => [2.101 + i * 0.05, 48.601] as [number, number]
    );
    const gj = JSON.stringify({ type: 'LineString', coordinates: coords });
    const trip: Trip = {
      startTimeMs: 0,
      endTimeMs: 5_820_000,
      startPlaceId: null,
      endPlaceId: null,
      distanceM: 178_700,
      durationS: 5820,
      dominantMode: 'car',
      co2G: 0,
      geojson: gj,
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
          endTimeMs: 5_820_000,
          mode: 'car',
          distanceM: 178_700,
          durationS: 5820,
          avgSpeedMps: 30.7,
          maxSpeedMps: 38,
          co2G: 0,
          geojson: gj,
        },
      ],
      breaks: [],
    };
    const db = createMockDb();
    await runMigrations(db);
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const deps: OverpassDeps = {
      db,
      cacheDb: async () => cacheDb,
      fetchFn: async () =>
        ({ status: 200, ok: true, json: async () => ({ elements: [] }) }) as unknown as Response,
      nowMs: () => 1_000_000,
      minIntervalMs: 0,
    };
    const id = await insertTripWithSections(db, trip);

    await enrichTripTransit(deps, id);

    const rows = await cacheDb.getAllAsync<{ cell_key: string }>(
      `SELECT cell_key FROM transit_cache WHERE cell_key LIKE 'waystile:%'`
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(24);
  });
});
