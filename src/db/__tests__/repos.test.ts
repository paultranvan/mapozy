import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertRawPoint, getUnconsumedPointsInRange, markPointsConsumed, countUnconsumedPoints } from '../rawPoints';
import { insertRawActivity, getAllUnconsumedActivities, markActivitiesConsumed } from '../rawActivities';
import { findOrCreatePlace, getPlaceById } from '../places';
import { insertTripWithSections, getTripById, listTrips, countTrips, deleteTrip } from '../trips';
import { getSetting, setSetting } from '../settings';
import {
  insertDiagnosticEvent,
  listDiagnosticEvents,
  countDiagnosticEvents,
  DIAGNOSTIC_EVENTS,
} from '../diagnostics';
import type { Db } from '../client';

describe('db repositories (in-memory via better-sqlite3)', () => {
  let db: Db;
  beforeEach(async () => {
    db = createMockDb();
    await runMigrations(db);
  });

  describe('rawPoints', () => {
    it('inserts and counts unconsumed', async () => {
      const id = await insertRawPoint(db, {
        timestampMs: 1_700_000_000_000,
        latitude: 45.0,
        longitude: 5.0,
        altitude: 200,
        accuracyMeters: 5,
        speedMps: 1.4,
        bearingDeg: 90,
        batteryLevel: 0.8,
        isCharging: false,
      });
      expect(id).toBeGreaterThan(0);
      expect(await countUnconsumedPoints(db)).toBe(1);
    });

    it('filters by range, marks consumed', async () => {
      const mk = (t: number) =>
        insertRawPoint(db, {
          timestampMs: t,
          latitude: 0,
          longitude: 0,
          altitude: null,
          accuracyMeters: 10,
          speedMps: null,
          bearingDeg: null,
          batteryLevel: null,
          isCharging: false,
        });
      const ids = [await mk(1000), await mk(2000), await mk(3000)];
      const pts = await getUnconsumedPointsInRange(db, 1500, 3500);
      expect(pts.map((p) => p.timestampMs)).toEqual([2000, 3000]);
      await markPointsConsumed(db, ids);
      expect(await countUnconsumedPoints(db)).toBe(0);
    });
  });

  describe('rawActivities', () => {
    it('inserts and marks consumed', async () => {
      const id = await insertRawActivity(db, {
        timestampMs: 1000,
        type: 'walking',
        confidence: 80,
      });
      const all = await getAllUnconsumedActivities(db);
      expect(all).toHaveLength(1);
      expect(all[0]!.type).toBe('walking');
      await markActivitiesConsumed(db, [id]);
      expect(await getAllUnconsumedActivities(db)).toHaveLength(0);
    });
  });

  describe('places', () => {
    it('creates a place when none nearby exists', async () => {
      const id = await findOrCreatePlace(db, 45.0, 5.0, 1000);
      const p = await getPlaceById(db, id);
      expect(p?.visitCount).toBe(1);
      expect(p?.firstSeenMs).toBe(1000);
    });

    it('reuses a place within 100m radius and increments visitCount', async () => {
      const id1 = await findOrCreatePlace(db, 45.0, 5.0, 1000);
      // ~30m east at this latitude
      const id2 = await findOrCreatePlace(db, 45.0, 5.0004, 2000);
      expect(id2).toBe(id1);
      const p = await getPlaceById(db, id1);
      expect(p?.visitCount).toBe(2);
      expect(p?.lastSeenMs).toBe(2000);
    });

    it('creates a distinct place when > 100m away', async () => {
      const id1 = await findOrCreatePlace(db, 45.0, 5.0, 1000);
      // ~500m north
      const id2 = await findOrCreatePlace(db, 45.004, 5.0, 2000);
      expect(id2).not.toBe(id1);
    });
  });

  describe('trips + sections', () => {
    it('inserts a trip with sections transactionally', async () => {
      const tripId = await insertTripWithSections(db, {
        startTimeMs: 1000,
        endTimeMs: 60_000,
        startPlaceId: null,
        endPlaceId: null,
        distanceM: 1000,
        durationS: 600,
        dominantMode: 'walk',
        co2G: 0,
        geojson: '{"type":"LineString","coordinates":[]}',
        manualPurpose: null,
        draft: false,
        draftReason: null,
        edited: false,
        locked: false,
        createdAtMs: 1000,
        sections: [
          {
            ordering: 0,
            startTimeMs: 1000,
            endTimeMs: 30_000,
            mode: 'walk',
            distanceM: 500,
            durationS: 300,
            avgSpeedMps: 1.66,
            maxSpeedMps: 2,
            co2G: 0,
            geojson: '{"type":"LineString","coordinates":[]}',
          },
          {
            ordering: 1,
            startTimeMs: 30_000,
            endTimeMs: 60_000,
            mode: 'walk',
            distanceM: 500,
            durationS: 300,
            avgSpeedMps: 1.66,
            maxSpeedMps: 2,
            co2G: 0,
            geojson: '{"type":"LineString","coordinates":[]}',
          },
        ],
        breaks: [],
      });
      expect(tripId).toBeGreaterThan(0);
      const trip = await getTripById(db, tripId);
      expect(trip?.sections).toHaveLength(2);
      expect(await countTrips(db)).toBe(1);
    });

    it('listTrips orders DESC by start_time_ms', async () => {
      const mk = (t: number) =>
        insertTripWithSections(db, {
          startTimeMs: t,
          endTimeMs: t + 1000,
          startPlaceId: null,
          endPlaceId: null,
          distanceM: 100,
          durationS: 10,
          dominantMode: 'walk',
          co2G: 0,
          geojson: '{}',
          manualPurpose: null,
          draft: false,
          draftReason: null,
          edited: false,
          locked: false,
          createdAtMs: t,
          sections: [],
          breaks: [],
        });
      await mk(1000);
      await mk(3000);
      await mk(2000);
      const trips = await listTrips(db, 10, 0);
      expect(trips.map((t) => t.startTimeMs)).toEqual([3000, 2000, 1000]);
    });

    it('deleteTrip cascades sections', async () => {
      const tripId = await insertTripWithSections(db, {
        startTimeMs: 1000,
        endTimeMs: 2000,
        startPlaceId: null,
        endPlaceId: null,
        distanceM: 100,
        durationS: 10,
        dominantMode: 'walk',
        co2G: 0,
        geojson: '{}',
        manualPurpose: null,
        draft: false,
        draftReason: null,
        edited: false,
        locked: false,
        createdAtMs: 1000,
        sections: [
          {
            ordering: 0,
            startTimeMs: 1000,
            endTimeMs: 2000,
            mode: 'walk',
            distanceM: 100,
            durationS: 10,
            avgSpeedMps: 10,
            maxSpeedMps: 10,
            co2G: 0,
            geojson: '{}',
          },
        ],
        breaks: [],
      });
      await deleteTrip(db, tripId);
      const sections = await db.getAllAsync(`SELECT * FROM sections WHERE trip_id = ?`, tripId);
      expect(sections).toHaveLength(0);
    });
  });

  describe('settings', () => {
    it('upserts and reads', async () => {
      await setSetting(db, 'foo', 'bar');
      expect(await getSetting(db, 'foo')).toBe('bar');
      await setSetting(db, 'foo', 'baz');
      expect(await getSetting(db, 'foo')).toBe('baz');
      expect(await getSetting(db, 'missing')).toBeNull();
    });
  });

  describe('tracker_diagnostics', () => {
    it('inserts, lists newest first, and round-trips JSON payloads', async () => {
      await insertDiagnosticEvent(db, 1_000, DIAGNOSTIC_EVENTS.AR_SUBSCRIBED, {
        api: 'transition',
        transitions: ['walking', 'in_vehicle'],
      });
      await insertDiagnosticEvent(
        db,
        2_000,
        DIAGNOSTIC_EVENTS.AR_SILENCE_DETECTED,
        { gapMs: 600_000, lastSpeed: 1.4 }
      );
      await insertDiagnosticEvent(db, 3_000, DIAGNOSTIC_EVENTS.AR_UNSUBSCRIBED, null);

      const all = await listDiagnosticEvents(db);
      expect(all.map((e) => e.timestampMs)).toEqual([3_000, 2_000, 1_000]);
      expect(all.map((e) => e.eventType)).toEqual([
        DIAGNOSTIC_EVENTS.AR_UNSUBSCRIBED,
        DIAGNOSTIC_EVENTS.AR_SILENCE_DETECTED,
        DIAGNOSTIC_EVENTS.AR_SUBSCRIBED,
      ]);
      expect(all[2]!.payload).toEqual({
        api: 'transition',
        transitions: ['walking', 'in_vehicle'],
      });
      expect(all[1]!.payload).toEqual({ gapMs: 600_000, lastSpeed: 1.4 });
      expect(all[0]!.payload).toBeNull();
    });

    it('filters by type and sinceMs', async () => {
      await insertDiagnosticEvent(db, 1_000, DIAGNOSTIC_EVENTS.AR_SILENCE_DETECTED, null);
      await insertDiagnosticEvent(db, 2_000, DIAGNOSTIC_EVENTS.AR_SUBSCRIBED, null);
      await insertDiagnosticEvent(db, 3_000, DIAGNOSTIC_EVENTS.AR_SILENCE_DETECTED, null);

      const silenceSince2k = await listDiagnosticEvents(db, {
        type: DIAGNOSTIC_EVENTS.AR_SILENCE_DETECTED,
        sinceMs: 2_000,
      });
      expect(silenceSince2k.map((e) => e.timestampMs)).toEqual([3_000]);

      expect(
        await countDiagnosticEvents(db, { type: DIAGNOSTIC_EVENTS.AR_SILENCE_DETECTED })
      ).toBe(2);
    });

    it('survives non-JSON payload strings gracefully', async () => {
      // Direct DB write — emulates a payload string a future caller might
      // store before the JSON-shape contract is widely adopted.
      await db.runAsync(
        `INSERT INTO tracker_diagnostics(timestamp_ms, event_type, payload) VALUES(?, ?, ?)`,
        4_000,
        'manual',
        'not-json'
      );
      const all = await listDiagnosticEvents(db, { type: 'manual' });
      expect(all[0]!.payload).toBe('not-json');
    });
  });
});
