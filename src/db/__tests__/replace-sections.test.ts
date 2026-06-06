import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  insertTripWithSections,
  getTripById,
  replaceTripSectionsAndBreaks,
  updateTripTotals,
} from '../trips';
import type { Trip, Section } from '../../types';

function carTrip(): Trip {
  const mkSec = (ordering: number): Section => ({
    ordering,
    startTimeMs: ordering * 1000,
    endTimeMs: ordering * 1000 + 500,
    mode: 'walk',
    distanceM: 100,
    durationS: 1,
    avgSpeedMps: 1,
    maxSpeedMps: 1,
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
  });
  return {
    startTimeMs: 0,
    endTimeMs: 5000,
    startPlaceId: null,
    endPlaceId: null,
    distanceM: 200,
    durationS: 5,
    dominantMode: 'walk',
    co2G: 0,
    geojson: '{"type":"LineString","coordinates":[]}',
    manualPurpose: null,
    draft: false,
    draftReason: null,
    edited: false,
    locked: false,
    createdAtMs: 0,
    sections: [mkSec(0), mkSec(1)],
    breaks: [{ ordering: 0, startTimeMs: 500, endTimeMs: 600_500, centerLat: 45, centerLon: 5, gap: true }],
  };
}

describe('replaceTripSectionsAndBreaks', () => {
  it('replaces all sections/breaks atomically and re-reads them', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await insertTripWithSections(db, carTrip());

    const newSections: Section[] = [
      { ordering: 0, startTimeMs: 0, endTimeMs: 500, mode: 'walk', distanceM: 100, durationS: 1, avgSpeedMps: 1, maxSpeedMps: 1, co2G: 0, geojson: '{"type":"LineString","coordinates":[]}' },
      { ordering: 1, startTimeMs: 500, endTimeMs: 600_500, mode: 'subway', distanceM: 800, durationS: 600, avgSpeedMps: 1.3, maxSpeedMps: 1.3, co2G: 2.9, geojson: '{"type":"LineString","coordinates":[]}', modeSource: 'gap', modeConfidence: 0.7 },
      { ordering: 2, startTimeMs: 600_500, endTimeMs: 601_000, mode: 'walk', distanceM: 100, durationS: 1, avgSpeedMps: 1, maxSpeedMps: 1, co2G: 0, geojson: '{"type":"LineString","coordinates":[]}' },
    ];

    await replaceTripSectionsAndBreaks(db, id, newSections, []);
    await updateTripTotals(db, id, 1000, 2.9, 'subway', '{"type":"LineString","coordinates":[]}');

    const t = await getTripById(db, id);
    expect(t!.sections.map((s) => s.mode)).toEqual(['walk', 'subway', 'walk']);
    expect(t!.sections[1]!.modeSource).toBe('gap');
    expect(t!.breaks).toHaveLength(0);
    expect(t!.dominantMode).toBe('subway');
    expect(t!.distanceM).toBe(1000);
  });
});
