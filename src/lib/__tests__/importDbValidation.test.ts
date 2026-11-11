import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { getSetting, setSetting, SETTING_KEYS } from '../../db/settings';
import {
  InvalidDatabaseError,
  preserveExternalApiOptOut,
  validateImportedDb,
} from '../importDbValidation';

async function mapozyDb() {
  const db = createMockDb();
  await runMigrations(db);
  return db;
}

describe('validateImportedDb', () => {
  it('accepts a genuine, fully migrated Mapozy database', async () => {
    await expect(validateImportedDb(await mapozyDb())).resolves.toBeUndefined();
  });

  it('rejects a SQLite file that is not a Mapozy database', async () => {
    const db = createMockDb();
    await db.execAsync('CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)');
    await expect(validateImportedDb(db)).rejects.toThrow(InvalidDatabaseError);
    await expect(validateImportedDb(db)).rejects.toThrow('not a Mapozy database');
  });

  it('rejects a database that is missing a core table', async () => {
    const db = await mapozyDb();
    await db.execAsync('DROP TABLE sections');
    await expect(validateImportedDb(db)).rejects.toThrow('not a Mapozy database');
  });

  it('rejects a database carrying a trigger', async () => {
    const db = await mapozyDb();
    await db.execAsync(
      `CREATE TRIGGER wipe AFTER INSERT ON raw_points BEGIN DELETE FROM trips; END`
    );
    await expect(validateImportedDb(db)).rejects.toThrow(InvalidDatabaseError);
    await expect(validateImportedDb(db)).rejects.toThrow('triggers or views');
  });

  it('rejects a database carrying a view', async () => {
    const db = await mapozyDb();
    await db.execAsync('CREATE VIEW v AS SELECT * FROM trips');
    await expect(validateImportedDb(db)).rejects.toThrow('triggers or views');
  });

  it('rejects a database that fails the integrity check', async () => {
    const db = await mapozyDb();
    const broken = Object.assign(Object.create(db), {
      getFirstAsync: async () => ({ quick_check: '*** in database main ***\nPage 7: btreeInitPage() returns error code 11' }),
    });
    await expect(validateImportedDb(broken)).rejects.toThrow('corrupted');
  });

  it('rejects a file SQLite cannot read at all', async () => {
    const db = await mapozyDb();
    const unreadable = Object.assign(Object.create(db), {
      getFirstAsync: async () => {
        throw new Error('file is not a database');
      },
    });
    await expect(validateImportedDb(unreadable)).rejects.toThrow(InvalidDatabaseError);
  });
});

describe('preserveExternalApiOptOut', () => {
  it('forces the kill switch off in the imported DB when the user had opted out', async () => {
    const db = await mapozyDb();
    await setSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API, '1');
    await preserveExternalApiOptOut(db, false);
    expect(await getSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API)).toBe('0');
  });

  it('writes the opt-out even when the imported DB never stored the setting', async () => {
    const db = await mapozyDb();
    await preserveExternalApiOptOut(db, false);
    expect(await getSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API)).toBe('0');
  });

  it('never turns external calls ON: an imported opt-out is kept as is', async () => {
    const db = await mapozyDb();
    await setSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API, '0');
    await preserveExternalApiOptOut(db, true);
    expect(await getSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API)).toBe('0');
  });
});
