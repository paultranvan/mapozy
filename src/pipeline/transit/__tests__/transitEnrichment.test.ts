import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { ensureTransitCacheSchema } from '../../../db/transitCacheDb';
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
  const cacheDb = createMockDb();
  await ensureTransitCacheSchema(cacheDb);
  return { db, cacheDb: async () => cacheDb, fetchFn, nowMs: () => 1_000_000, minIntervalMs: 0 } as OverpassDeps;
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

describe('enrichTripTransit durability', () => {
  it('skips locked trips entirely', async () => {
    const deps = await depsWith(railFetch());
    const id = await insertTripWithSections(deps.db, carTrip());
    await deps.db.runAsync(`UPDATE trips SET locked = 1 WHERE id = ?`, id);

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('skipped');

    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('car'); // unchanged
  });

  it('does not overwrite a section that has user_mode set', async () => {
    const deps = await depsWith(railFetch());
    const id = await insertTripWithSections(deps.db, carTrip());
    const secs = (await getTripById(deps.db, id))!.sections;
    await deps.db.runAsync(`UPDATE sections SET user_mode = 'bus' WHERE id = ?`, secs[0]!.id!);

    const res = await enrichTripTransit(deps, id);
    expect(res.changed).toBe(0);

    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.mode).toBe('car'); // auto mode untouched
    expect(t!.sections[0]!.userMode).toBe('bus'); // override preserved
  });
});

function encodePolyline(coords: Array<[number, number]>, precision = 6): string {
  const factor = Math.pow(10, precision);
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  const enc = (v: number) => {
    let val = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (val >= 0x20) {
      s += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
      val >>= 5;
    }
    return s + String.fromCharCode(val + 63);
  };
  for (const [lon, lat] of coords) {
    const latE = Math.round(lat * factor);
    const lngE = Math.round(lon * factor);
    out += enc(latE - lastLat) + enc(lngE - lastLng);
    lastLat = latE;
    lastLng = lngE;
  }
  return out;
}

function walkTrip(): Trip {
  const coords = driveCoords();
  const geojson = JSON.stringify({ type: 'LineString', coordinates: coords });
  return {
    ...carTrip(),
    dominantMode: 'walk',
    geojson,
    sections: [{ ...carTrip().sections[0]!, mode: 'walk', geojson }],
  };
}

// fetch mock: snapped shape for the Valhalla endpoint, empty for Overpass.
function valhallaFetch(
  snapped: Array<[number, number]>,
  confidence: number
): OverpassDeps['fetchFn'] {
  return async (url) => {
    if (String(url).includes('trace_attributes')) {
      return fakeResponse({
        shape: encodePolyline(snapped),
        confidence_score: confidence,
      });
    }
    return fakeResponse({ elements: [] });
  };
}

describe('enrichTripTransit — map-matching (Pass 3)', () => {
  const snapped: Array<[number, number]> = [
    [lon0 + 0.0001, lat0],
    [lon0 + 0.0001, lat0 + 0.0045],
  ];

  it('stores snapped geometry on a walk section when confidence is high', async () => {
    const deps = await depsWith(valhallaFetch(snapped, 0.9));
    const id = await insertTripWithSections(deps.db, walkTrip());

    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('enriched');

    const t = await getTripById(deps.db, id);
    const matched = t!.sections[0]!.matchedGeojson;
    expect(matched).toBeTruthy();
    const parsed = JSON.parse(matched!);
    expect(parsed.type).toBe('LineString');
    expect(parsed.coordinates[0][0]).toBeCloseTo(snapped[0]![0], 5);
  });

  it('keeps the raw trace (no match) when confidence is below threshold', async () => {
    const deps = await depsWith(valhallaFetch(snapped, 0.2));
    const id = await insertTripWithSections(deps.db, walkTrip());

    await enrichTripTransit(deps, id);

    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.matchedGeojson ?? null).toBeNull();
    expect(t!.draft).toBe(false); // map-matching failure never drafts
  });

  it('skips Valhalla entirely for sections below the distance floor', async () => {
    // Half the Valhalla traffic of a full-history enrichment was snapping
    // sub-300 m stubs (2026-07-14 export: 136 of 266 candidate sections)
    // whose matched line changes nothing visually. They must not cost a
    // network call.
    let valhallaCalls = 0;
    const inner = valhallaFetch(snapped, 0.9);
    const deps = await depsWith(async (url, init) => {
      if (String(url).includes('trace_attributes')) valhallaCalls++;
      return inner!(url, init);
    });
    const tiny = walkTrip();
    tiny.distanceM = 150;
    tiny.sections[0]!.distanceM = 150;
    const id = await insertTripWithSections(deps.db, tiny);

    const res = await enrichTripTransit(deps, id);

    expect(res.status).toBe('enriched');
    expect(valhallaCalls).toBe(0);
    const t = await getTripById(deps.db, id);
    expect(t!.sections[0]!.matchedGeojson ?? null).toBeNull();
  });
});
