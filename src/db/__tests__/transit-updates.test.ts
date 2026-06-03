import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertTripWithSections, getTripById, setTripDraft, updateTripAggregates } from '../trips';
import { updateSectionClassification } from '../sections';
import type { Trip } from '../../types';

function tripWithCarSection(): Trip {
  return {
    startTimeMs: 0,
    endTimeMs: 1000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 1000,
    durationS: 100,
    dominantMode: 'car',
    co2G: 218,
    geojson: '{"type":"LineString","coordinates":[]}',
    manualPurpose: null,
    draft: true,
    draftReason: 'offline',
    createdAtMs: 0,
    sections: [
      {
        ordering: 0,
        startTimeMs: 0,
        endTimeMs: 1000,
        mode: 'car',
        distanceM: 1000,
        durationS: 100,
        avgSpeedMps: 10,
        maxSpeedMps: 12,
        co2G: 218,
        geojson: '{"type":"LineString","coordinates":[]}',
      },
    ],
    breaks: [],
  };
}

describe('transit DB updates', () => {
  it('updateSectionClassification rewrites mode/source/confidence/co2', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, tripWithCarSection());
    const before = await getTripById(db, id);
    const secId = before!.sections[0]!.id!;

    await updateSectionClassification(db, secId, 'train', 'railmatch', 0.95, 24.1);

    const after = await getTripById(db, id);
    const s = after!.sections[0]!;
    expect(s.mode).toBe('train');
    expect(s.modeSource).toBe('railmatch');
    expect(s.modeConfidence).toBeCloseTo(0.95, 5);
    expect(s.co2G).toBeCloseTo(24.1, 5);
  });

  it('setTripDraft + updateTripAggregates clear draft and rewrite totals', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, tripWithCarSection());

    await updateTripAggregates(db, id, 'train', 24.1);
    await setTripDraft(db, id, false, null);

    const t = await getTripById(db, id);
    expect(t!.dominantMode).toBe('train');
    expect(t!.co2G).toBeCloseTo(24.1, 5);
    expect(t!.draft).toBe(false);
    expect(t!.draftReason).toBeNull();
  });
});
