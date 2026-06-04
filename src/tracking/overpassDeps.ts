import type { Db } from '../db/client';
import type { OverpassDeps } from '../lib/overpass';

// Real-network Overpass deps for the running app: the live `fetch` and default
// rate-limit/TTL. Tests build OverpassDeps directly with an injected fetchFn.
export function makeOverpassDeps(db: Db): OverpassDeps {
  return { db, fetchFn: fetch };
}
