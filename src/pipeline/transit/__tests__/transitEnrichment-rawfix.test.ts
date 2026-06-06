import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { insertTripWithSections, getTripById } from '../../../db/trips';
import { insertRawPoint } from '../../../db/rawPoints';
import { enrichTripTransit } from '../transitEnrichment';
import type { OverpassDeps } from '../../../lib/overpass';
import type { Trip } from '../../../types';

// Reproduces the real subway bug: underground rides emit sparse fixes that sit
// ON the rail, but the 10-s resampled trace draws straight chords across the
// 1-2 km gaps that bow far off the curved track. Rail-match must use the RAW
// fixes, not the resampled trace.
const lat0 = 45.0;
const lon0 = 5.0;
const A: [number, number] = [lon0, lat0];
const B: [number, number] = [lon0, lat0 + 0.01]; // apex ~1.1 km north
const C: [number, number] = [lon0 + 0.01, lat0 + 0.01];

// An L-shaped subway way A->B->C.
const subwayWay = {
  type: 'way',
  id: 1,
  tags: { railway: 'subway' },
  geometry: [
    { lat: A[1], lon: A[0] },
    { lat: B[1], lon: B[0] },
    { lat: C[1], lon: C[0] },
  ],
};

// Resampled section geojson: a STRAIGHT chord A->C, 11 evenly-spaced points.
// Its mid-points lie ~400 m off the L-shaped rail, so resampled coverage @25m
// is ~18% — well under the 80% rule.
function chordCoords(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    out.push([A[0] + (C[0] - A[0]) * (i / 10), A[1] + (C[1] - A[1]) * (i / 10)]);
  }
  return out;
}

function carTrip(): Trip {
  const gj = JSON.stringify({ type: 'LineString', coordinates: chordCoords() });
  return {
    startTimeMs: 0,
    endTimeMs: 900_000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 7600,
    durationS: 900,
    dominantMode: 'car',
    co2G: 1657,
    geojson: gj,
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
        endTimeMs: 900_000,
        mode: 'car',
        distanceM: 7600,
        durationS: 900,
        avgSpeedMps: 8.4,
        maxSpeedMps: 20,
        co2G: 1657,
        geojson: gj,
      },
    ],
    breaks: [],
  };
}

function fakeResponse(body: unknown) {
  return { status: 200, ok: true, json: async () => body } as unknown as Response;
}
function railFetch(): OverpassDeps['fetchFn'] {
  return async (_url, init) => {
    const body = String((init as RequestInit).body ?? '');
    if (body.includes('way%5B%22railway') || body.includes('way["railway')) {
      return fakeResponse({ elements: [subwayWay] });
    }
    return fakeResponse({ elements: [] });
  };
}

describe('enrichTripTransit — rail match uses raw fixes, not the resampled trace', () => {
  it('classifies a sparse-fix car section as subway when raw fixes hug the rail', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, carTrip());

    // 3 sparse raw fixes ON the rail (A, B, C) inside the section window — the
    // signature of a subway ride that surfaced briefly.
    for (const [i, p] of [A, B, C].entries()) {
      await insertRawPoint(db, {
        timestampMs: i * 300_000, // 0, 5min, 10min — within [0, 900_000]
        latitude: p[1],
        longitude: p[0],
        altitude: null,
        accuracyMeters: 8,
        speedMps: null,
        bearingDeg: null,
        batteryLevel: null,
        isCharging: false,
      });
    }

    const deps: OverpassDeps = { db, fetchFn: railFetch(), nowMs: () => 1, minIntervalMs: 0 };
    const res = await enrichTripTransit(deps, id);
    expect(res.status).toBe('enriched');

    const t = await getTripById(db, id);
    expect(t!.sections[0]!.mode).toBe('subway');
    expect(t!.sections[0]!.modeSource).toBe('railmatch');
  });

  it('still falls back to the resampled trace when no raw fixes exist', async () => {
    // A section whose resampled trace DOES follow a straight rail (no raw points
    // stored) must still match — proving the fallback path is intact.
    const db = createMockDb();
    await runMigrations(db);
    const straight: Array<[number, number]> = [];
    for (let i = 0; i <= 9; i++) straight.push([lon0, lat0 + 0.0005 * i]);
    const gj = JSON.stringify({ type: 'LineString', coordinates: straight });
    const trip = carTrip();
    trip.geojson = gj;
    trip.sections[0]!.geojson = gj;
    const id = await insertTripWithSections(db, trip);

    const straightWay = {
      type: 'way',
      id: 2,
      tags: { railway: 'rail' },
      geometry: [
        { lat: lat0, lon: lon0 },
        { lat: lat0 + 0.0045, lon: lon0 },
      ],
    };
    const fetchFn: OverpassDeps['fetchFn'] = async (_url, init) => {
      const body = String((init as RequestInit).body ?? '');
      if (body.includes('way%5B%22railway') || body.includes('way["railway')) {
        return fakeResponse({ elements: [straightWay] });
      }
      return fakeResponse({ elements: [] });
    };
    const deps: OverpassDeps = { db, fetchFn, nowMs: () => 1, minIntervalMs: 0 };
    await enrichTripTransit(deps, id);
    const t = await getTripById(db, id);
    expect(t!.sections[0]!.mode).toBe('train'); // railway=rail -> train
  });
});
