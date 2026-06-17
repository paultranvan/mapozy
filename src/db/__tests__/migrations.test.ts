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

  it('creates the transit_cache table', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const t = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='transit_cache'`
    );
    expect(t?.name).toBe('transit_cache');
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
