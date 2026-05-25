import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

export type Db = SQLite.SQLiteDatabase;

export async function openDb(name = 'mapozy.db'): Promise<Db> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

export { runMigrations };
