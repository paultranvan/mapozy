import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  recordSentTravel,
  getSentSignatures,
  isSignatureSent,
} from '../connectorTravels';

// connector_travels no longer FKs to trips(id) (migration 013): dedup keys on
// a content signature that survives a Mapozy recompute deleting/recreating
// trips with new ids, so mapozy_trip_id is now plain informational data and
// tests don't need a real trips row.

describe('connectorTravels repo', () => {
  it('records a sent travel and reports it as sent', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const sig = 'sig-1';
    expect(await isSignatureSent(db, 'tiime', sig)).toBe(false);
    await recordSentTravel(db, 'tiime', sig, '5560117', 1_700_000_000_000, 42);
    expect(await isSignatureSent(db, 'tiime', sig)).toBe(true);
    expect(await getSentSignatures(db, 'tiime')).toEqual(new Set([sig]));
  });

  it('is idempotent on re-record (no duplicate row)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const sig = 'sig-2';
    await recordSentTravel(db, 'tiime', sig, 'a', 1, 1);
    await recordSentTravel(db, 'tiime', sig, 'b', 2, 2);
    expect(await getSentSignatures(db, 'tiime')).toEqual(new Set([sig]));
  });

  it('records a null mapozy_trip_id without error', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const sig = 'sig-3';
    await recordSentTravel(db, 'tiime', sig, 'a', 1, null);
    expect(await isSignatureSent(db, 'tiime', sig)).toBe(true);
  });
});
