import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';
import { loadExternalApiSetting } from '../lib/net';

export type Db = SQLite.SQLiteDatabase;

export async function openDb(name = 'mapozy.db'): Promise<Db> {
  const db = await SQLite.openDatabaseAsync(name);
  // TRUNCATE (rollback journal), NOT WAL. The tracker's native side uses
  // android.database.sqlite to write into this same file; mixing two SQLite
  // library implementations in WAL mode caused header/page-count drift and
  // "database disk image is malformed" corruption. Rollback journal uses
  // plain file locking which both libraries honor identically.
  await db.execAsync('PRAGMA journal_mode = TRUNCATE;');
  // Wait for a contended lock instead of failing on the spot. Without it a
  // COMMIT that lands while another connection holds the file (the native
  // tracker inserting a fix, or any transient reader) throws SQLITE_BUSY
  // "database is locked" immediately — observed on the emulator as a leg's
  // mode edit silently not saving (tester: "impossible de modifier les
  // vignettes"). 5 s is far above any single write on this DB.
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  // The file on disk is not necessarily one we wrote: Settings → "Import
  // database" swaps in a user-supplied file. Tell SQLite not to trust its
  // schema, so SQL functions and virtual tables with side effects cannot be
  // invoked from views, triggers, CHECK constraints, defaults or indexes
  // defined by whoever authored it. Mapozy's own schema uses none of these.
  await db.execAsync('PRAGMA trusted_schema = OFF;');
  await runMigrations(db);
  // Prime the external-API toggle cache from the persisted setting so every
  // call site (Overpass/Nominatim/Valhalla) can read it synchronously.
  await loadExternalApiSetting(db);
  return db;
}

export { runMigrations };
