import * as FileSystem from 'expo-file-system';
import type { Db } from '@/db/client';
import { buildExportFilename } from './sendDbToPaulFilename';

export type DbExport = {
  destPath: string;
  filename: string;
};

export async function prepareDbExport(db: Db, now: Date = new Date()): Promise<DbExport> {
  // Flush WAL into the main database file so the copy reflects all writes.
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');

  const sourcePath = `${FileSystem.documentDirectory}SQLite/mapozy.db`;
  const filename = buildExportFilename(now);
  const destPath = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.copyAsync({ from: sourcePath, to: destPath });

  return { destPath, filename };
}
