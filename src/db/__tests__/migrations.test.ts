import { createMockDb } from '../mockDb';
import { runMigrations, getSchemaVersion } from '../migrations';

describe('migration 004', () => {
  it('adds draft columns to trips and metadata columns to sections', async () => {
    const db = createMockDb();
    await runMigrations(db);

    expect(await getSchemaVersion(db)).toBeGreaterThanOrEqual(4);

    const tripCols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(trips)`
    );
    const tripNames = tripCols.map((c) => c.name);
    expect(tripNames).toContain('draft');
    expect(tripNames).toContain('draft_reason');

    const sectionCols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(sections)`
    );
    const sectionNames = sectionCols.map((c) => c.name);
    expect(sectionNames).toContain('mode_source');
    expect(sectionNames).toContain('mode_confidence');
  });
});

describe('migration 006: trip editing columns', () => {
  it('adds user_mode to sections and locked/edited to trips', async () => {
    const db = createMockDb();
    await runMigrations(db);
    expect(await getSchemaVersion(db)).toBeGreaterThanOrEqual(6);

    const secCols = (
      await db.getAllAsync<{ name: string }>(`PRAGMA table_info(sections)`)
    ).map((r) => r.name);
    expect(secCols).toContain('user_mode');

    const tripCols = (
      await db.getAllAsync<{ name: string }>(`PRAGMA table_info(trips)`)
    ).map((r) => r.name);
    expect(tripCols).toEqual(expect.arrayContaining(['locked', 'edited']));
  });
});

describe('migration 008: places kind/name/category', () => {
  it('adds kind/name/category to places, preserving rows', async () => {
    const db = createMockDb();
    await runMigrations(db);
    // insert a legacy-style auto place
    await db.runAsync(
      `INSERT INTO places (latitude, longitude, radius_m, visit_count, first_seen_ms, last_seen_ms)
       VALUES (?, ?, 50, 3, 1, 2)`,
      45.75, 4.85
    );
    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(places)`);
    const names = cols.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['kind', 'name', 'category']));
    const row = await db.getFirstAsync<{ kind: string; visit_count: number }>(
      `SELECT kind, visit_count FROM places LIMIT 1`
    );
    expect(row?.kind).toBe('auto');
    expect(row?.visit_count).toBe(3);
  });
});

describe('migration 009: suggestion_dismissed column', () => {
  it('adds suggestion_dismissed to places, defaulting to 0 on a new auto row', async () => {
    const db = createMockDb();
    await runMigrations(db);
    expect(await getSchemaVersion(db)).toBeGreaterThanOrEqual(9);

    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(places)`);
    const names = cols.map((c) => c.name);
    expect(names).toContain('suggestion_dismissed');

    await db.runAsync(
      `INSERT INTO places (latitude, longitude, radius_m, visit_count, first_seen_ms, last_seen_ms)
       VALUES (?, ?, 50, 1, 1, 2)`,
      45.75, 4.85
    );
    const row = await db.getFirstAsync<{ suggestion_dismissed: number }>(
      `SELECT suggestion_dismissed FROM places LIMIT 1`
    );
    expect(row?.suggestion_dismissed).toBe(0);
  });
});

describe('migration 010: custom_categories table', () => {
  it('creates the custom_categories table with name, icon, color columns', async () => {
    const db = createMockDb();
    await runMigrations(db);
    expect(await getSchemaVersion(db)).toBeGreaterThanOrEqual(10);

    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(custom_categories)`
    );
    const names = cols.map((c) => c.name);
    expect(names).toContain('name');
    expect(names).toContain('icon');
    expect(names).toContain('color');
  });
});

describe('migration 011: drop transit_cache', () => {
  it('migration 011 drops the main-DB transit_cache (cache moved to its own file)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const row = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='transit_cache'`
    );
    expect(row).toBeNull();
  });
});

describe('migration 012', () => {
  it('adds structured address columns to places', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(places)`
    );
    const names = cols.map((c) => c.name);
    for (const c of ['street', 'house_number', 'postal_code', 'city', 'country']) {
      expect(names).toContain(c);
    }
  });

});

describe('migration 013', () => {
  it('creates connector_travels with a unique (type, signature) constraint and no trip FK', async () => {
    const db = createMockDb();
    await runMigrations(db);
    // mapozy_trip_id is now plain informational data (nullable, no FK), so no
    // real trips row is required to insert here.
    await db.runAsync(
      `INSERT INTO connector_travels(connector_type, signature, mapozy_trip_id, external_travel_id, sent_at) VALUES('tiime', 'sig-1', NULL, 'x', 100)`
    );
    let rejected = false;
    try {
      await db.runAsync(
        `INSERT INTO connector_travels(connector_type, signature, mapozy_trip_id, external_travel_id, sent_at) VALUES('tiime', 'sig-1', NULL, 'y', 200)`
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('allows mapozy_trip_id to reference a trip that no longer exists', async () => {
    const db = createMockDb();
    await runMigrations(db);
    // A trip id that was never created (or has since been deleted by a
    // recompute) must not be rejected: there is no FK on this column anymore.
    await db.runAsync(
      `INSERT INTO connector_travels(connector_type, signature, mapozy_trip_id, external_travel_id, sent_at) VALUES('tiime', 'sig-2', 999999, 'z', 300)`
    );
    const row = await db.getFirstAsync<{ mapozy_trip_id: number }>(
      `SELECT mapozy_trip_id FROM connector_travels WHERE signature = 'sig-2'`
    );
    expect(row?.mapozy_trip_id).toBe(999999);
  });
});
