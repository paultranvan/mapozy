import type { Db } from '../../../db/client';
import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import {
  listCandidates,
  sendCandidate,
  travelSignature,
  type Coord,
  type TiimeCandidate,
} from '../travels';

const EMPTY_ADDR = {
  street: null,
  houseNumber: null,
  postalCode: null,
  city: null,
  country: null,
};

// A place a user tagged as their workplace. Trips are matched to it by
// geographic proximity (nearestUserPoi), NOT via the trip's start/end place
// FK columns — those reference auto-clustered places that are frequently
// evicted/dangling and don't carry the user's category tag.
const WORK: Coord = { lat: 48.8, lon: 2.3 };
// Far outside the 100m work zone.
const HOME: Coord = { lat: 48.9, lon: 2.4 };
const ELSEWHERE_A: Coord = { lat: 48.95, lon: 2.5 };
const ELSEWHERE_B: Coord = { lat: 49.0, lon: 2.6 };

function lineStringGeojson(departure: Coord, arrival: Coord): string {
  return JSON.stringify({
    type: 'LineString',
    coordinates: [
      [departure.lon, departure.lat],
      [arrival.lon, arrival.lat],
    ],
  });
}

async function insertUserPlace(
  db: Db,
  opts: { name: string; category: string; coord: Coord; radiusM?: number }
): Promise<number> {
  const now = 1_700_000_000_000;
  const res = await db.runAsync(
    `INSERT INTO places(kind, name, category, latitude, longitude, radius_m, first_seen_ms, last_seen_ms)
     VALUES('user', ?, ?, ?, ?, ?, ?, ?)`,
    opts.name,
    opts.category,
    opts.coord.lat,
    opts.coord.lon,
    opts.radiusM ?? 100,
    now,
    now
  );
  return res.lastInsertRowId as number;
}

async function insertTrip(
  db: Db,
  opts: {
    departure: Coord;
    arrival: Coord;
    mode?: string;
    startMs?: number;
    distanceM?: number;
  }
): Promise<number> {
  const startMs = opts.startMs ?? 1_700_000_000_000;
  const geojson = lineStringGeojson(opts.departure, opts.arrival);
  const res = await db.runAsync(
    `INSERT INTO trips(start_time_ms, end_time_ms, distance_m, duration_s, dominant_mode, geojson, created_at_ms)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    startMs,
    startMs + 1_800_000,
    opts.distanceM ?? 32000,
    1800,
    opts.mode ?? 'car',
    geojson,
    startMs
  );
  return res.lastInsertRowId as number;
}

function findCandidate(cands: TiimeCandidate[], tripId: number): TiimeCandidate | undefined {
  return cands.find((c) => c.tripId === tripId);
}

describe('travelSignature', () => {
  const startMs = 1_700_000_000_000;
  const base = { startMs, distanceM: 32000, departure: WORK, arrival: HOME };

  it('is stable for identical content and ignores trip id', () => {
    expect(travelSignature(base)).toBe(travelSignature({ ...base }));
  });

  it('differs when distance or endpoint coordinates differ', () => {
    expect(travelSignature(base)).not.toBe(travelSignature({ ...base, distanceM: 33000 }));
    expect(travelSignature(base)).not.toBe(
      travelSignature({ ...base, arrival: ELSEWHERE_A })
    );
    expect(travelSignature(base)).not.toBe(
      travelSignature({ ...base, departure: ELSEWHERE_A })
    );
  });

  it('produces the day|km|lat,lon|lat,lon coord-based format', () => {
    const d = new Date(startMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expectedDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const sig = travelSignature({
      startMs,
      distanceM: 32499,
      departure: { lat: 48.8, lon: 2.3 },
      arrival: { lat: 48.85001, lon: 2.35001 },
    });
    expect(sig).toBe(`${expectedDay}|32|48.8000,2.3000|48.8500,2.3500`);
  });
});

describe('listCandidates', () => {
  it('includes a car trip whose ARRIVAL lands inside a work-tagged place zone, with the place name as arrivalCompanyName', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: HOME, arrival: WORK });

    const cands = await listCandidates(db);
    const found = findCandidate(cands, trip);
    expect(found).toBeDefined();
    expect(found?.arrivalCompanyName).toBe('Acme Corp');
    expect(found?.departure).toEqual(HOME);
    expect(found?.arrival).toEqual(WORK);
  });

  it('includes a car trip whose DEPARTURE lands inside a work-tagged place zone', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: WORK, arrival: HOME });

    const cands = await listCandidates(db);
    expect(findCandidate(cands, trip)).toBeDefined();
  });

  it('excludes a car trip far from every work place', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: ELSEWHERE_A, arrival: ELSEWHERE_B });

    const cands = await listCandidates(db);
    expect(findCandidate(cands, trip)).toBeUndefined();
  });

  it('excludes a non-car trip even if it ends at the work place (mode filter)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: HOME, arrival: WORK, mode: 'bike' });

    const cands = await listCandidates(db);
    expect(findCandidate(cands, trip)).toBeUndefined();
  });

  it('returns no candidates when the user has no work-tagged place at all', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Home', category: 'home', coord: HOME });
    await insertTrip(db, { departure: HOME, arrival: WORK });

    const cands = await listCandidates(db);
    expect(cands).toEqual([]);
  });

  it('excludes a recomputed trip (new trip id, same endpoints/day/km) already sent under a different id', async () => {
    // Core fix under test: Mapozy recompute deletes+recreates trips with a NEW
    // id but stable endpoint coordinates (from the geojson, not the volatile
    // place FK). A trip already sent to Tiime must not reappear as a
    // candidate just because its trip id changed.
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const tripA = await insertTrip(db, { departure: HOME, arrival: WORK });

    const post = jest.fn(async () => ({ id: 999 }));
    const client = { get: jest.fn(), post } as any;

    const candsBefore = await listCandidates(db);
    const candidate = findCandidate(candsBefore, tripA);
    if (!candidate) throw new Error('expected tripA to be a candidate');

    await sendCandidate(db, client, candidate, {
      vehicleId: 58697,
      companyId: 243813,
      roundTrip: false,
      arrivalCompanyName: 'Acme Corp',
      departure: EMPTY_ADDR,
      arrival: EMPTY_ADDR,
    });

    // Simulate recompute: a brand-new trip id, identical start time,
    // distance and endpoints (as a fresh geojson would still encode).
    const tripB = await insertTrip(db, { departure: HOME, arrival: WORK });
    expect(tripB).not.toBe(tripA);

    const candsAfter = await listCandidates(db);
    expect(findCandidate(candsAfter, tripB)).toBeUndefined();
  });

  it('sends a candidate, POSTs to the verified path, and records dedup', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: HOME, arrival: WORK });

    const post = jest.fn(async () => ({ id: 999 }));
    const client = { get: jest.fn(), post } as any;

    const cands = await listCandidates(db);
    const candidate = findCandidate(cands, trip);
    if (!candidate) throw new Error('expected a candidate');

    const id = await sendCandidate(db, client, candidate, {
      vehicleId: 58697,
      companyId: 243813,
      roundTrip: false,
      arrivalCompanyName: 'Acme Corp',
      departure: EMPTY_ADDR,
      arrival: EMPTY_ADDR,
    });

    expect(id).toBe(999);
    expect(post).toHaveBeenCalledWith(
      '/v1/companies/243813/users/me/travels',
      expect.objectContaining({ vehicle_id: 58697 })
    );

    const candsAfter = await listCandidates(db);
    expect(findCandidate(candsAfter, trip)).toBeUndefined();
  });
});
