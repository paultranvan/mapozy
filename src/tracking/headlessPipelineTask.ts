import type { Db } from '../db/client';
import { getSharedDb } from '../db/sharedDb';
import { insertDiagnosticEvent } from '../db/diagnostics';
import { runPipeline } from '../pipeline/runPipeline';
import { makeOverpassDeps } from './overpassDeps';

/**
 * Task key the native PipelineHeadlessTaskService starts and index.js
 * registers with AppRegistry — keep the three in sync.
 */
export const HEADLESS_PIPELINE_TASK = 'MapozyPipeline';

/**
 * Background trip segmentation, started by the native tracker at each
 * MOVING→STATIONARY transition via a React Native headless task. Exists
 * because nothing else runs when the OS has killed the app process: the
 * 2026-07-14 export showed three days of trips (84–96) all segmented in one
 * batch at the next app open. The headless task boots a JS context without
 * UI and drains segmentation right at trip end, so trips exist (as drafts)
 * before the user ever opens the app.
 *
 * Segmentation ONLY — local SQLite work, done in seconds. The network-bound
 * enrichment pass is deliberately NOT kicked here: RN pauses timers in
 * background outside headless windows, Doze gates the network, and a
 * long-running background network pass is a battery cost this app has always
 * refused. Drafts are picked up by the normal foreground kicks.
 *
 * When the app process is alive, the same Db instance (getSharedDb) puts
 * this run on the same serialization chain as the UI-triggered runs — a
 * double fire (native event listener + headless start) makes the second run
 * a no-op instead of a duplicate-trip race.
 *
 * Must NEVER reject: an unhandled headless-task rejection surfaces as a
 * native error. Failures are recorded as diagnostics, best-effort.
 */
export function makeHeadlessPipelineTask(
  getDb: () => Promise<Db> = getSharedDb
): (taskData?: unknown) => Promise<void> {
  // Factory (not a default parameter on the task itself): AppRegistry invokes
  // the task with its taskData map as FIRST argument, which would silently
  // replace an injectable-param default — emulator-verified 2026-07-19 as
  // "TypeError: Object is not a function" on `await taskData()`.
  return async (_taskData?: unknown): Promise<void> => {
    // console logging is the only signal that survives when the DB itself is
    // the thing that failed to open — keep it permanent (headless has no UI).
    console.log('[headlessPipelineTask] start');
    let db: Db | null = null;
    try {
      db = await getDb();
      const r = await runPipeline(db, { transit: makeOverpassDeps(db) });
      console.log(
        `[headlessPipelineTask] done trips=${r.tripsInserted} points=${r.pointsConsumed}`
      );
      await insertDiagnosticEvent(db, Date.now(), 'headless_pipeline_run', {
        tripsInserted: r.tripsInserted,
        pointsConsumed: r.pointsConsumed,
        activitiesConsumed: r.activitiesConsumed,
        pendingEnrichment: r.pendingEnrichmentTripIds.length,
      });
    } catch (err) {
      console.warn(
        '[headlessPipelineTask] failed',
        err,
        (err as Error)?.stack ?? 'no-stack'
      );
      if (db) {
        await insertDiagnosticEvent(db, Date.now(), 'headless_pipeline_error', {
          message: String((err as Error)?.message ?? err),
        }).catch(() => {
          /* diagnostics are best-effort */
        });
      }
    }
  };
}

/** The instance index.js registers — production wiring, shared-DB backed. */
export const headlessPipelineTask = makeHeadlessPipelineTask();
