/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Wraps a better-sqlite3 connection in the app's async `Db` interface so the
 * real pipeline code can run against an export in Node (reprocess-db,
 * enrich-trips).
 */
export function makeAdapter(raw: any) {
  const norm = (params: any[]) =>
    params.map((p) =>
      p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p
    );
  return {
    async getAllAsync<T = any>(sql: string, ...params: any[]): Promise<T[]> {
      return raw.prepare(sql).all(...norm(params)) as T[];
    },
    async getFirstAsync<T = any>(sql: string, ...params: any[]): Promise<T | null> {
      const r = raw.prepare(sql).get(...norm(params));
      return (r ?? null) as T | null;
    },
    async runAsync(sql: string, ...params: any[]) {
      const r = raw.prepare(sql).run(...norm(params));
      return {
        lastInsertRowId: Number(r.lastInsertRowid),
        changes: Number(r.changes),
      };
    },
    async execAsync(sql: string): Promise<void> {
      raw.exec(sql);
    },
    async withTransactionAsync(cb: () => Promise<void>): Promise<void> {
      raw.exec('BEGIN');
      try {
        await cb();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
