/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/**
 * Reprocess a Mapozy DB export through the CURRENT pipeline code.
 *
 * Copies the source DB, runs migrations, wipes derived tables (trips,
 * sections, trip_breaks), resets consumption + place visit counts, then runs
 * the real `runPipeline` so the output is byte-for-byte what the app would
 * produce — but with whatever fixes are in the working tree today. Places
 * (and their geocoded display_names / labels) are preserved; only their
 * visit_count is recomputed.
 *
 * Usage: npx tsx scripts/reprocess-db.ts <source.db> <out.db>
 */
import * as fs from 'fs';
import { runMigrations } from '../src/db/migrations';
import { runPipeline } from '../src/pipeline/runPipeline';

function makeAdapter(raw: any) {
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

async function main() {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error('Usage: reprocess-db <source.db> <out.db>');
    process.exit(1);
  }
  fs.copyFileSync(src, out);
  const Better = require('better-sqlite3');
  const raw = new Better(out);
  raw.pragma('journal_mode = TRUNCATE');
  raw.pragma('foreign_keys = ON');
  const db = makeAdapter(raw) as any;

  await runMigrations(db);

  // Wipe derived data; reset consumption + visit counts so the pipeline
  // rebuilds everything from raw points exactly as a fresh run would.
  raw.exec('DELETE FROM trip_breaks; DELETE FROM sections; DELETE FROM trips;');
  raw.exec('UPDATE raw_points SET consumed = 0;');
  raw.exec('UPDATE raw_activities SET consumed = 0;');
  raw.exec('UPDATE places SET visit_count = 0;');
  raw.exec("DELETE FROM settings WHERE key = 'last_known_place_id';");

  const maxTs = (raw.prepare('SELECT MAX(timestamp_ms) m FROM raw_points').get() as any).m as number;

  const res = await runPipeline(db, { upToMs: maxTs + 1, nowMs: maxTs });
  console.log('runPipeline result:', JSON.stringify(res));

  const trips = raw.prepare('SELECT COUNT(*) c FROM trips').get() as any;
  const sections = raw.prepare('SELECT COUNT(*) c FROM sections').get() as any;
  const breaks = raw.prepare('SELECT COUNT(*) c FROM trip_breaks').get() as any;
  console.log(`trips=${trips.c} sections=${sections.c} trip_breaks=${breaks.c}`);
  raw.close();
  console.log(`Wrote ${out}`);
}

main();
