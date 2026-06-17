import type { Db } from '../db/client';
import type { OverpassDeps } from '../lib/overpass';
import { externalApiAllowed, externalFetch } from '../lib/net';

// Real-network Overpass deps for the running app: routes through `externalFetch`
// (the toggle choke-point) with the default rate-limit/TTL. Tests build
// OverpassDeps directly with an injected fetchFn.
//
// Returns `undefined` when the user has disabled the external API — callers pass
// this straight to `runPipeline({ transit })` / enrichment, which then skips
// the whole network pass and finalizes trips with local-only processing (no
// lingering drafts). This is the graceful fallback; `externalFetch` is the hard
// backstop in case any path slips through.
export function makeOverpassDeps(db: Db): OverpassDeps | undefined {
  if (!externalApiAllowed()) return undefined;
  return { db, fetchFn: externalFetch };
}
