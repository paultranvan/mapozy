import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { insertRawPoint, getUnconsumedPointsInRange, markPointsConsumed, countUnconsumedPoints } from '../rawPoints';
import { insertRawActivity, getAllUnconsumedActivities, markActivitiesConsumed } from '../rawActivities';
import { findOrCreatePlace, getPlaceById, setPlaceLabel } from '../places';
import { insertTripWithSections, getTripById, listTrips, countTrips, deleteTrip } from '../trips';
import { getSetting, setSetting } from '../settings';
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

    it('sets and reads label', async () => {
      const id = await findOrCreatePlace(db, 45.0, 5.0, 1000);
      await setPlaceLabel(db, id, 'home');
      const p = await getPlaceById(db, id);
      expect(p?.label).toBe('home');
      await setPlaceLabel(db, id, null);
      const p2 = await getPlaceById(db, id);
      expect(p2?.label).toBeNull();
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
          createdAtMs: t,
          sections: [],
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
});
