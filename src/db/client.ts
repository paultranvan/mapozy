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
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  // Prime the external-API toggle cache from the persisted setting so every
  // call site (Overpass/Nominatim/Valhalla) can read it synchronously.
  await loadExternalApiSetting(db);
  return db;
}

export { runMigrations };
