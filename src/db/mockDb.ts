/**
 * In-memory mock of the expo-sqlite SQLiteDatabase interface, used only in
 * unit tests. Real DB integration is verified end-to-end on the emulator.
 *
 * Backed by better-sqlite3 if available, else by a hand-rolled SQL-like
 * structure that supports the small subset of SQL we use (CREATE TABLE,
 * INSERT, UPDATE, DELETE, SELECT with WHERE/ORDER/LIMIT/COUNT/SUM/MAX,
 * CASCADE on delete). For pipeline tests we typically use the structured
 * approach since better-sqlite3 may not be present.
 */

import type { Db } from './client';

interface PreparedRow extends Record<string, unknown> {}

function buildArgs(args: unknown[]): unknown[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

export function createMockDb(): Db {
  let better: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Better = require('better-sqlite3');
    better = new Better(':memory:');
    better.pragma('foreign_keys = ON');
  } catch {
    throw new Error(
      'createMockDb requires better-sqlite3 to be installed (dev dependency).'
    );
  }

  const adapter: any = {
    async execAsync(sql: string) {
      better.exec(sql);
    },
    async runAsync(sql: string, ...args: unknown[]) {
      const stmt = better.prepare(sql);
      const r = stmt.run(...buildArgs(args));
      return {
        lastInsertRowId: r.lastInsertRowid as number,
        changes: r.changes as number,
      };
    },
    async getFirstAsync(sql: string, ...args: unknown[]) {
      const stmt = better.prepare(sql);
      return (stmt.get(...buildArgs(args)) ?? null) as PreparedRow | null;
    },
    async getAllAsync(sql: string, ...args: unknown[]) {
      const stmt = better.prepare(sql);
      return stmt.all(...buildArgs(args)) as PreparedRow[];
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      better.exec('BEGIN');
      try {
        await fn();
        better.exec('COMMIT');
      } catch (e) {
        better.exec('ROLLBACK');
        throw e;
      }
    },
    closeAsync() {
      better.close();
      return Promise.resolve();
    },
  };

  return adapter as Db;
}
