import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { recordSentTravel } from '../../../db/connectorTravels';
import { listCandidates, sendCandidate, travelSignature } from '../travels';

// Insert a trip + two places directly, categorising one as 'work'.
async function seedCarTrip(
  db: any,
  opts: { work: 'start' | 'end'; mode?: string; startMs?: number }
) {
  const now = opts.startMs ?? 1_700_000_000_000;
  const startPlace = await db.runAsync(
    `INSERT INTO places(kind, category, latitude, longitude, radius_m, first_seen_ms, last_seen_ms, city, street)
     VALUES('user', ?, 48.8, 2.3, 50, ?, ?, 'Paris', 'Rue A')`,
    opts.work === 'start' ? 'work' : 'home', now, now
  );
  const endPlace = await db.runAsync(
    `INSERT INTO places(kind, category, latitude, longitude, radius_m, first_seen_ms, last_seen_ms, city, street)
     VALUES('user', ?, 48.9, 2.4, 50, ?, ?, 'Issy', 'Rue B')`,
    opts.work === 'end' ? 'work' : 'home', now, now
  );
  const trip = await db.runAsync(
    `INSERT INTO trips(start_time_ms, end_time_ms, start_place_id, end_place_id, distance_m, duration_s, dominant_mode, geojson, created_at_ms)
     VALUES(?, ?, ?, ?, 32000, 1800, ?, '{}', ?)`,
    now, now + 1800000, startPlace.lastInsertRowId, endPlace.lastInsertRowId, opts.mode ?? 'car', now
  );
  return {
    tripId: trip.lastInsertRowId as number,
    startPlaceId: startPlace.lastInsertRowId as number,
    endPlaceId: endPlace.lastInsertRowId as number,
  };
}

describe('travelSignature', () => {
  it('is stable for identical content and ignores trip id', () => {
    const a = travelSignature({
      startMs: 1_700_000_000_000,
      distanceM: 32000,
      departurePlaceId: 1,
      arrivalPlaceId: 2,
    });
    const b = travelSignature({
      startMs: 1_700_000_000_000,
      distanceM: 32000,
      departurePlaceId: 1,
      arrivalPlaceId: 2,
    });
    expect(a).toBe(b);
  });

  it('differs when distance or places differ', () => {
    const base = { startMs: 1_700_000_000_000, distanceM: 32000, departurePlaceId: 1, arrivalPlaceId: 2 };
    expect(travelSignature(base)).not.toBe(travelSignature({ ...base, distanceM: 33000 }));
    expect(travelSignature(base)).not.toBe(travelSignature({ ...base, arrivalPlaceId: 3 }));
  });

  it('handles null place ids', () => {
    const sig = travelSignature({
      startMs: 1_700_000_000_000,
      distanceM: 32000,
      departurePlaceId: null,
      arrivalPlaceId: null,
    });
    expect(sig).toContain('x|x');
  });
});

describe('tiime travels domain', () => {
  it('lists car trips touching a work place, excluding already-sent', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const t1 = await seedCarTrip(db, { work: 'end' });
    await seedCarTrip(db, { work: 'start', mode: 'bike' }); // not car → excluded
    const sent = await seedCarTrip(db, { work: 'start' });
    const sig = travelSignature({
      startMs: 1_700_000_000_000,
      distanceM: 32000,
      departurePlaceId: sent.startPlaceId,
      arrivalPlaceId: sent.endPlaceId,
    });
    await recordSentTravel(db, 'tiime', sig, 'x', 1, sent.tripId);

    const cands = await listCandidates(db);
    expect(cands.map((c) => c.tripId)).toEqual([t1.tripId]);
  });

  it('excludes a recomputed trip (new trip id, same content) from candidates', async () => {
    // This is the core fix: Mapozy recompute deletes+recreates trips with a
    // NEW id, but places are stable. A trip already sent to Tiime must not
    // reappear as a candidate just because its trip id changed.
    const db = createMockDb();
    await runMigrations(db);
    const original = await seedCarTrip(db, { work: 'end' });

    const post = jest.fn(async () => ({ id: 999 }));
    const client = { get: jest.fn(), post } as any;
    const addr = { street: 'Rue A', houseNumber: null, postalCode: '75000', city: 'Paris', country: 'FR' };
    const candsBefore = await listCandidates(db);
    const first = candsBefore[0];
    if (!first) throw new Error('expected a candidate');
    await sendCandidate(db, client, first, {
      vehicleId: 58697, companyId: 243813, roundTrip: false,
      arrivalCompanyName: 'ACME', departure: addr, arrival: addr,
    });

    // Simulate recompute: delete the original trip, insert a new one with a
    // different id but identical start time / distance / place ids.
    await db.runAsync(`DELETE FROM trips WHERE id = ?`, original.tripId);
    const recomputed = await db.runAsync(
      `INSERT INTO trips(start_time_ms, end_time_ms, start_place_id, end_place_id, distance_m, duration_s, dominant_mode, geojson, created_at_ms)
       VALUES(?, ?, ?, ?, 32000, 1800, 'car', '{}', ?)`,
      1_700_000_000_000, 1_700_000_000_000 + 1800000,
      original.startPlaceId, original.endPlaceId, 1_700_000_000_000
    );
    expect(recomputed.lastInsertRowId).not.toBe(original.tripId);

    const candsAfter = await listCandidates(db);
    expect(candsAfter.find((c) => c.tripId === recomputed.lastInsertRowId)).toBeUndefined();
  });

  it('sends a candidate, POSTs to the verified path, and records dedup', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const t1 = await seedCarTrip(db, { work: 'end' });
    const cands = await listCandidates(db);

    const post = jest.fn(async () => ({ id: 999 }));
    const client = { get: jest.fn(), post } as any;
    const addr = { street: 'Rue A', houseNumber: null, postalCode: '75000', city: 'Paris', country: 'FR' };

    const first = cands[0];
    if (!first) throw new Error('expected a candidate');
    const id = await sendCandidate(db, client, first, {
      vehicleId: 58697, companyId: 243813, roundTrip: false,
      arrivalCompanyName: 'ACME', departure: addr, arrival: addr,
    });

    expect(id).toBe(999);
    expect(post).toHaveBeenCalledWith('/v1/companies/243813/users/me/travels', expect.objectContaining({ vehicle_id: 58697 }));
    const cands2 = await listCandidates(db);
    expect(cands2.find((c) => c.tripId === t1.tripId)).toBeUndefined();
  });
});
