import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { recordSentTravel } from '../../../db/connectorTravels';
import { listCandidates, sendCandidate } from '../travels';

// Insert a trip + two places directly, categorising one as 'work'.
async function seedCarTrip(db: any, opts: { work: 'start' | 'end'; mode?: string }) {
  const now = 1_700_000_000_000;
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
  return trip.lastInsertRowId as number;
}

describe('tiime travels domain', () => {
  it('lists car trips touching a work place, excluding already-sent', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const t1 = await seedCarTrip(db, { work: 'end' });
    await seedCarTrip(db, { work: 'start', mode: 'bike' }); // not car → excluded
    const sent = await seedCarTrip(db, { work: 'start' });
    await recordSentTravel(db, 'tiime', sent, 'x', 1);

    const cands = await listCandidates(db);
    expect(cands.map((c) => c.tripId)).toEqual([t1]);
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
    expect(cands2.find((c) => c.tripId === t1)).toBeUndefined();
  });
});
