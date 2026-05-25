/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/**
 * One-off diagnostic: run the real pipeline against a SQLite file dump from a
 * user's device. Reports what segments / trips / places the pipeline produces
 * and which raw rows it leaves unconsumed. Not committed permanently.
 */
import type { Db } from '../src/db/client';
import { runPipeline } from '../src/pipeline/runPipeline';
import { segmentation } from '../src/pipeline/segmentation';
import { accuracyFilter } from '../src/pipeline/accuracyFilter';
import { getAllUnconsumedPoints } from '../src/db/rawPoints';
import { getAllUnconsumedActivities } from '../src/db/rawActivities';

function openFileBackedDb(path: string): Db {
  const Better = require('better-sqlite3');
  const handle = new Better(path);
  handle.pragma('foreign_keys = ON');

  const buildArgs = (args: unknown[]): unknown[] =>
    args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;

  const adapter: any = {
    async execAsync(sql: string) { handle.exec(sql); },
    async runAsync(sql: string, ...args: unknown[]) {
      const r = handle.prepare(sql).run(...buildArgs(args));
      return { lastInsertRowId: r.lastInsertRowid, changes: r.changes };
    },
    async getFirstAsync(sql: string, ...args: unknown[]) {
      return handle.prepare(sql).get(...buildArgs(args)) ?? null;
    },
    async getAllAsync(sql: string, ...args: unknown[]) {
      return handle.prepare(sql).all(...buildArgs(args));
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      handle.exec('BEGIN');
      try { await fn(); handle.exec('COMMIT'); }
      catch (e) { handle.exec('ROLLBACK'); throw e; }
    },
    closeAsync() { handle.close(); return Promise.resolve(); },
  };
  return adapter as Db;
}

async function main() {
  const dbPath = process.argv[2];
  if (!dbPath) { console.error('Usage: diag-pipeline <db-path>'); process.exit(1); }

  const db = openFileBackedDb(dbPath);

  const pointsBefore = await getAllUnconsumedPoints(db);
  const actsBefore = await getAllUnconsumedActivities(db);
  console.log(`\n=== Before pipeline ===`);
  console.log(`  unconsumed points: ${pointsBefore.length}`);
  console.log(`  unconsumed activities: ${actsBefore.length}`);

  const filtered = accuracyFilter(pointsBefore);
  console.log(`  after accuracyFilter: ${filtered.length}`);

  const segs = segmentation(filtered, actsBefore);
  console.log(`\n=== Segments (${segs.length}) ===`);
  for (const [i, s] of segs.entries()) {
    if (s.kind === 'trip') {
      const f = s.points[0]!; const l = s.points[s.points.length - 1]!;
      console.log(`  [${i}] trip   ${s.points.length} pts  ${new Date(f.timestampMs).toISOString()} → ${new Date(l.timestampMs).toISOString()}`);
    } else {
      console.log(`  [${i}] stay   ${new Date(s.startMs).toISOString()} → ${new Date(s.endMs).toISOString()}  center=${s.centerLat.toFixed(5)},${s.centerLon.toFixed(5)}`);
    }
  }

  console.log(`\n=== Running runPipeline ===`);
  const result = await runPipeline(db);
  console.log(`  tripsInserted: ${result.tripsInserted}`);
  console.log(`  pointsConsumed: ${result.pointsConsumed}`);
  console.log(`  activitiesConsumed: ${result.activitiesConsumed}`);

  const pointsAfter = await getAllUnconsumedPoints(db);
  const actsAfter = await getAllUnconsumedActivities(db);
  const trips = (await (db as any).getAllAsync('SELECT * FROM trips ORDER BY started_at_ms')) as any[];
  const sections = (await (db as any).getAllAsync('SELECT * FROM sections ORDER BY started_at_ms')) as any[];
  const places = (await (db as any).getAllAsync('SELECT * FROM places ORDER BY id')) as any[];

  console.log(`\n=== After pipeline ===`);
  console.log(`  trips: ${trips.length}`);
  for (const t of trips) console.log(`    trip id=${t.id} ${new Date(t.started_at_ms).toISOString()} → ${new Date(t.ended_at_ms).toISOString()}  distance=${t.distance_m}m`);
  console.log(`  sections: ${sections.length}`);
  for (const s of sections) console.log(`    sec id=${s.id} trip=${s.trip_id} mode=${s.mode} dist=${s.distance_m}m`);
  console.log(`  places: ${places.length}`);
  for (const p of places) console.log(`    place id=${p.id} ${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`);
  console.log(`  remaining unconsumed points: ${pointsAfter.length}`);
  console.log(`  remaining unconsumed activities: ${actsAfter.length}`);

  await db.closeAsync();
}

main().catch((e) => { console.error(e); process.exit(1); });
