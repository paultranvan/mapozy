import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { insertTripWithSections, getTripById } from '../../../db/trips';
import { enrichTripTransit } from '../transitEnrichment';
import type { OverpassDeps } from '../../../lib/overpass';
import type { Trip } from '../../../types';

const lat0 = 45.0;
const lon0 = 5.0;

function driveCoords(): Array<[number, number]> {
  const c: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) c.push([lon0, lat0 + 0.0005 * i]);
  return c;
}

function carTrip(): Trip {
  const coords = driveCoords();
  return {
    startTimeMs: 0,
    endTimeMs: 600_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 5000,
    durationS: 600,
    dominantMode: 'car',
    co2G: 1090,
    geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [
      {
        ordering: 0,
        startTimeMs: 0,
        endTimeMs: 600_000,
        mode: 'car',
        distanceM: 5000,
        durationS: 600,
        avgSpeedMps: 8.3,
        maxSpeedMps: 30,
        co2G: 1090,
        geojson: JSON.stringify({ type: 'LineString', coordinates: coords }),
      },
    ],
    breaks: [],
  };
}

function fakeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  return {
    status: init.status ?? 200,
    ok: init.ok ?? true,
    json: async () => body,
  } as unknown as Response;
}

// fetch mock: railway way along the drive for the ways query, empty for stops.
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
              { lat: lat0, lon: lon0 },
              { lat: lat0 + 0.0045, lon: lon0 },
            ],
          },
        ],
      });
    }
    return fakeResponse({ elements: [] });
  };
}

async function depsWith(fetchFn: OverpassDeps['fetchFn']) {
  const db = createMockDb();
  await runMigrations(db);
  return { db, fetchFn, nowMs: () => 1_000_000, minIntervalMs: 0 } as OverpassDeps;
}

describe('enrichTripTransit', () => {
  it('reclassifies a car section that follows a rail line to train', async () => {
    const deps = await depsWith(railFetch());
    const id = await insertTripWithSections(deps.db, carTrip());

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('enriched');
    expect(res.changed).toBe(1);

    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('train');
    expect(t!.sections[0]!.modeSource).toBe('railmatch');
    expect(t!.dominantMode).toBe('train');
    expect(t!.draft).toBe(false);
    // CO2 recomputed at the train factor (0.0241 kg/km * 5 km * 1000 = 120.5 g).
    expect(t!.co2G).toBeCloseTo(120.5, 1);
  });

  it('marks the trip draft on a rate-limit and leaves the car label', async () => {
    const deps = await depsWith(async () => fakeResponse({}, { status: 429, ok: false }));
    const id = await insertTripWithSections(deps.db, carTrip());

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('draft');
    expect(res.reason).toBe('rate_limited');

    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('car');
    expect(t!.draft).toBe(true);
    expect(t!.draftReason).toBe('rate_limited');
  });

  it('marks the trip draft offline when fetch rejects', async () => {
    const deps = await depsWith(async () => {
      throw new TypeError('Network request failed');
    });
    const id = await insertTripWithSections(deps.db, carTrip());
    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('draft');
    expect(res.reason).toBe('offline');
  });

  it('is idempotent — re-running after success makes no further changes', async () => {
    const deps = await depsWith(railFetch());
    const id = await insertTripWithSections(deps.db, carTrip());
    await enrichTripTransit(deps, id);
    const res2 = await enrichTripTransit(deps, id);
    expect(res2.changed).toBe(0);
    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('train');
  });
});
