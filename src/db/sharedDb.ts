import type { Db } from './client';

// Process-wide main-DB singleton. Pipeline runs are serialized per Db
// INSTANCE (the WeakMap chain in runPipeline), so every runtime entry point —
// the app UI (RootLayout) and the native-triggered headless pipeline task —
// MUST resolve the same instance; a second handle on the same file would
// bypass the serialization and race into duplicate trips (seen 14× before
// ac69cd6). Lives outside client.ts so Node-side tests can import it without
// pulling in expo-sqlite.

let shared: Promise<Db> | null = null;

async function defaultOpen(): Promise<Db> {
  const { openDb } = await import('./client');
  return openDb();
}

export function getSharedDb(open: () => Promise<Db> = defaultOpen): Promise<Db> {
  if (shared === null) {
    shared = open();
    // A failed open (disk pressure, migration error) must not wedge every
    // future caller onto the same rejected promise.
    shared.catch(() => {
      shared = null;
    });
  }
  return shared;
}

/** Test-only: forget the singleton between tests. */
export function _resetSharedDbForTests(): void {
  shared = null;
}
