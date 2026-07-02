// A draft that fails enrichment with a NON-Overpass error used to vanish into a
// console.warn — leaving a permanent NULL-reason draft no refresh could clear,
// and no trace in the export to root-cause it. refreshDraftTrips must instead
// persist the swallowed error to tracker_diagnostics.
jest.mock('../../pipeline/transit/transitEnrichment', () => ({
  enrichTripTransit: jest.fn(),
}));

import { createMockDb } from '../../db/mockDb';
import { runMigrations } from '../../db/migrations';
import { ensureTransitCacheSchema } from '../../db/transitCacheDb';
import { insertTripWithSections } from '../../db/trips';
import { listDiagnosticEvents } from '../../db/diagnostics';
import { refreshDraftTrips } from '../refreshDrafts';
import { enrichTripTransit } from '../../pipeline/transit/transitEnrichment';
import type { OverpassDeps } from '../../lib/overpass';
import type { Trip } from '../../types';

const mockEnrich = enrichTripTransit as jest.MockedFunction<typeof enrichTripTransit>;

function draftTrip(): Trip {
  const gj = JSON.stringify({ type: 'LineString', coordinates: [[5, 45], [5, 45.01]] });
  return {
    startTimeMs: 0, endTimeMs: 600_000, startPlaceId: null, endPlaceId: null,
    distanceM: 5000, durationS: 600, dominantMode: 'car', co2G: 1090, geojson: gj,
    manualPurpose: null, draft: true, draftReason: null, edited: false, locked: false,
    createdAtMs: 0,
    sections: [{ ordering: 0, startTimeMs: 0, endTimeMs: 600_000, mode: 'car', distanceM: 5000, durationS: 600, avgSpeedMps: 8.3, maxSpeedMps: 30, co2G: 1090, geojson: gj }],
    breaks: [],
  };
}

describe('refreshDraftTrips diagnostics', () => {
  it('persists a transit_enrich_error event when enrichment throws', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, draftTrip());
    mockEnrich.mockRejectedValue(new Error('boom in enrichment'));
    const cacheDb = createMockDb();
    await ensureTransitCacheSchema(cacheDb);
    const deps: OverpassDeps = { db, cacheDb: async () => cacheDb, fetchFn: async () => ({}) as unknown as Response };

    const res = await refreshDraftTrips(db, deps);

    expect(res.enriched).toBe(0);
    const events = await listDiagnosticEvents(db, { type: 'transit_enrich_error' });
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as { tripId: number; message: string };
    expect(payload.tripId).toBe(id);
    expect(payload.message).toContain('boom in enrichment');
  });
});
