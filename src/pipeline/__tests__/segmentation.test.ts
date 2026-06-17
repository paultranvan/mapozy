import { segmentation } from '../segmentation';
import { mkPoint, mkActivity, syntheticTrip, resetIds } from './_fixtures';
import type { RawPoint, RawActivity } from '../../types';

describe('segmentation', () => {
  beforeEach(() => resetIds());

  it('returns no trips when fewer than 2 dwell windows', () => {
    // single stay point set
    const pts = [
      mkPoint(0, 45.0, 5.0),
      mkPoint(60_000, 45.0, 5.0),
    ];
    const segs = segmentation(pts, [], { dwellMinutes: 1, dwellRadiusM: 50 });
    expect(segs.filter((s) => s.kind === 'trip')).toHaveLength(0);
  });

  it('detects a single trip between two dwell windows in synthetic data', () => {
    const { points } = syntheticTrip();
    const segs = segmentation(points, [], { dwellMinutes: 5, dwellRadiusM: 100 });
    const trips = segs.filter((s) => s.kind === 'trip');
    const stays = segs.filter((s) => s.kind === 'stay');
    expect(trips).toHaveLength(1);
    expect(stays).toHaveLength(2);
  });

  it('does not treat a 6-min stationary window as a stay when in_vehicle activity is present (traffic jam)', () => {
    const t0 = 1_700_000_000_000;
    const lat = 50.0;
    const lon = 10.0;
    const pts: RawPoint[] = [];
    for (let i = 0; i <= 6; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat, lon));
    }
    const acts: RawActivity[] = [];
    for (let i = 0; i <= 6; i++) {
      acts.push(mkActivity(t0 + i * 60_000, 'in_vehicle', 85));
    }
    const segs = segmentation(pts, acts, { dwellMinutes: 5, dwellRadiusM: 100 });
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(0);
  });

  it('treats a long stationary window as a stay even with in_vehicle activity present (a long stop is not a traffic jam)', () => {
    // 30 min motionless at one spot with in_vehicle reported throughout — e.g.
    // a spurious in_vehicle while parked, or a departure event bleeding into the
    // dwell. A genuinely long stationary period must end the trip regardless of
    // what the activity classifier says (RULE_STALLED_VEHICLE_GUARD ceiling).
    const t0 = 1_700_000_000_000;
    const lat = 50.0;
    const lon = 10.0;
    const pts: RawPoint[] = [];
    for (let i = 0; i <= 30; i++) pts.push(mkPoint(t0 + i * 60_000, lat, lon));
    const acts: RawActivity[] = [];
    for (let i = 0; i <= 30; i++) {
      acts.push(mkActivity(t0 + i * 60_000, 'in_vehicle', 85));
    }
    const segs = segmentation(pts, acts, { dwellMinutes: 5, dwellRadiusM: 100 });
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(1);
  });

  it('still treats a 6-min stationary window as a stay when activity is still/on_foot', () => {
    const t0 = 1_700_000_000_000;
    const lat = 50.0;
    const lon = 10.0;
    const pts: RawPoint[] = [];
    for (let i = 0; i <= 6; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat, lon));
    }
    const acts: RawActivity[] = [];
    for (let i = 0; i <= 6; i++) {
      acts.push(mkActivity(t0 + i * 60_000, 'still', 95));
    }
    const segs = segmentation(pts, acts, { dwellMinutes: 5, dwellRadiusM: 100 });
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(1);
  });

  it('still treats a 6-min stationary window as a stay when no activities are recorded (back-compat)', () => {
    const t0 = 1_700_000_000_000;
    const lat = 50.0;
    const lon = 10.0;
    const pts: RawPoint[] = [];
    for (let i = 0; i <= 6; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat, lon));
    }
    const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100 });
    expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(1);
  });

  it('keeps a long-distance gap with plausible speed as one trip (RULE_GAP_PLAUSIBILITY)', () => {
    // ~2h GPS gap covering ~78km — could plausibly be a continuous drive on a
    // route with no signal. Should NOT be split with an implicit stay.
    const t0 = 1_700_000_000_000;
    const pts: ReturnType<typeof mkPoint>[] = [];
    // Stay at A for 10 minutes
    for (let i = 0; i <= 10; i++) pts.push(mkPoint(t0 + i * 60_000, 48.0, 2.0));
    // Last sample right before signal loss
    pts.push(mkPoint(t0 + 11 * 60_000, 48.0, 2.0));
    // Next sample 2h later, 78km north (avg ~10.8 m/s — plausible)
    pts.push(mkPoint(t0 + 11 * 60_000 + 2 * 60 * 60_000, 48.7, 2.0));
    // Stay at B for 10 minutes
    const stayB0 = t0 + 11 * 60_000 + 2 * 60 * 60_000 + 60_000;
    for (let i = 0; i <= 10; i++) pts.push(mkPoint(stayB0 + i * 60_000, 48.7, 2.0));

    const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100 });
    const stays = segs.filter((s) => s.kind === 'stay');
    const trips = segs.filter((s) => s.kind === 'trip');
    expect(stays).toHaveLength(2);
    expect(trips).toHaveLength(1);
  });

  it('still treats a long-distance gap past the hard ceiling as a stay (RULE_GAP_PLAUSIBILITY hard break)', () => {
    // 25h gap covering ~555km would have a plausible-looking avg speed,
    // but at this scale (past the 24h ceiling) the average means nothing —
    // the user could have stayed still for 24h then driven for 1h. Force a stay.
    const t0 = 1_700_000_000_000;
    const pts: ReturnType<typeof mkPoint>[] = [];
    for (let i = 0; i <= 10; i++) pts.push(mkPoint(t0 + i * 60_000, 48.0, 2.0));
    pts.push(mkPoint(t0 + 11 * 60_000, 48.0, 2.0));
    pts.push(mkPoint(t0 + 11 * 60_000 + 25 * 60 * 60_000, 53.0, 2.0));
    const stayB0 = t0 + 11 * 60_000 + 25 * 60 * 60_000 + 60_000;
    for (let i = 0; i <= 10; i++) pts.push(mkPoint(stayB0 + i * 60_000, 53.0, 2.0));

    const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100 });
    const stays = segs.filter((s) => s.kind === 'stay');
    expect(stays.length).toBeGreaterThanOrEqual(3);
  });

  describe('RULE_STATIONARY_BOUNDARY: trip/stay boundary refinement', () => {
    it('trip extends to the actual stop point, not to the dwell circle edge', () => {
      // Stay at A for 10 min, walk 500m east at ~1 m/s, arrive and stay 10 min
      const t0 = 1_700_000_000_000;
      const latA = 48.0;
      const lonA = 2.0;
      // 500m east at lat 48 ≈ 0.00673 deg lon
      const latB = 48.0;
      const lonB = 2.0 + 500 / (111_320 * Math.cos((48 * Math.PI) / 180));

      const pts: RawPoint[] = [];
      // stay at A
      for (let i = 0; i <= 10; i++) pts.push(mkPoint(t0 + i * 60_000, latA, lonA));
      // walking 500m east over ~500s — points every 10s
      const walkStart = t0 + 11 * 60_000;
      for (let i = 1; i <= 50; i++) {
        const f = i / 50;
        pts.push(mkPoint(walkStart + i * 10_000, latA, lonA + (lonB - lonA) * f));
      }
      // stationary at B for 10 min
      const arrived = walkStart + 50 * 10_000;
      for (let i = 0; i <= 20; i++) pts.push(mkPoint(arrived + i * 30_000, latB, lonB));

      const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100 });
      const trips = segs.filter((s) => s.kind === 'trip') as {
        kind: 'trip';
        points: RawPoint[];
      }[];
      expect(trips).toHaveLength(1);
      const lastTripPt = trips[0]!.points[trips[0]!.points.length - 1]!;
      // Before fix: last point sits ~100m short (the dwell anchor).
      // After fix: last point should be within ~15m of the stop (the stationary threshold).
      const gap = Math.abs(lastTripPt.longitude - lonB) * 111_320 * Math.cos((48 * Math.PI) / 180);
      expect(gap).toBeLessThan(20);
    });

    it('stay duration reflects the stationary phase, not the dwell circle dwell time', () => {
      const t0 = 1_700_000_000_000;
      const latA = 48.0;
      const lonA = 2.0;
      const latB = 48.0;
      const lonB = 2.0 + 500 / (111_320 * Math.cos((48 * Math.PI) / 180));

      const pts: RawPoint[] = [];
      for (let i = 0; i <= 10; i++) pts.push(mkPoint(t0 + i * 60_000, latA, lonA));
      const walkStart = t0 + 11 * 60_000;
      // 90 seconds of approach inside the eventual 100m dwell bubble (walking the last ~90m at 1 m/s)
      for (let i = 1; i <= 50; i++) {
        const f = i / 50;
        pts.push(mkPoint(walkStart + i * 10_000, latA, lonA + (lonB - lonA) * f));
      }
      const arrived = walkStart + 50 * 10_000;
      for (let i = 0; i <= 20; i++) pts.push(mkPoint(arrived + i * 30_000, latB, lonB));

      const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100 });
      const stays = segs.filter((s) => s.kind === 'stay') as {
        kind: 'stay';
        startMs: number;
        endMs: number;
      }[];
      expect(stays).toHaveLength(2);
      // The stay at B should start at (or very near) the moment the walker stopped,
      // not at the moment they entered the dwell circle.
      const stayB = stays[1]!;
      expect(Math.abs(stayB.startMs - arrived)).toBeLessThan(60_000);
    });

    it('a brief mid-trip pause that is NOT a dwell does not get treated as a stay', () => {
      // 60s pause is well under DWELL_STAY 5-min minimum — should remain inside the trip.
      const t0 = 1_700_000_000_000;
      const lat0 = 48.0;
      const lon0 = 2.0;
      const pts: RawPoint[] = [];
      // 10 min stay at A
      for (let i = 0; i <= 10; i++) pts.push(mkPoint(t0 + i * 60_000, lat0, lon0));
      // walk 1km east, pause for 60s in the middle, continue
      const walkStart = t0 + 11 * 60_000;
      const metersPerDegLon = 111_320 * Math.cos((48 * Math.PI) / 180);
      for (let i = 1; i <= 20; i++) {
        pts.push(mkPoint(walkStart + i * 15_000, lat0, lon0 + (500 * i) / 20 / metersPerDegLon));
      }
      // 60s pause at midpoint
      const pauseAt = walkStart + 20 * 15_000;
      const pauseLon = lon0 + 500 / metersPerDegLon;
      for (let i = 1; i <= 4; i++) pts.push(mkPoint(pauseAt + i * 15_000, lat0, pauseLon));
      const resumeAt = pauseAt + 4 * 15_000;
      for (let i = 1; i <= 20; i++) {
        pts.push(mkPoint(resumeAt + i * 15_000, lat0, pauseLon + (500 * i) / 20 / metersPerDegLon));
      }
      // stay at B for 10 min
      const arrived = resumeAt + 20 * 15_000;
      const endLon = pauseLon + 500 / metersPerDegLon;
      for (let i = 0; i <= 10; i++) pts.push(mkPoint(arrived + i * 60_000, lat0, endLon));

      const segs = segmentation(pts, [], { dwellMinutes: 5, dwellRadiusM: 100 });
      const trips = segs.filter((s) => s.kind === 'trip');
      const stays = segs.filter((s) => s.kind === 'stay');
      expect(trips).toHaveLength(1);
      expect(stays).toHaveLength(2);
    });
  });

  it('treats a long gap at a different location as an implicit stay', () => {
    // Home cluster, then a walk, then a 2h gap, then home again
    const t0 = 1_700_000_000_000;
    const lat0 = 48.0;
    const lon0 = 2.0;
    const pts: ReturnType<typeof mkPoint>[] = [];
    // Stay at home for 10 minutes
    for (let i = 0; i <= 10; i++) {
      pts.push(mkPoint(t0 + i * 60_000, lat0, lon0));
    }
    // Walk 1km north over 5 min
    const walkStart = t0 + 11 * 60_000;
    for (let i = 1; i <= 5; i++) {
      pts.push(mkPoint(walkStart + i * 60_000, lat0 + 0.002 * i, lon0));
    }
    // 2h gap, then home again for 10 min
    const homeAgain = walkStart + 5 * 60_000 + 2 * 60 * 60_000;
    for (let i = 0; i <= 10; i++) {
      pts.push(mkPoint(homeAgain + i * 60_000, lat0, lon0));
    }

    const segs = segmentation(pts, [], {
      dwellMinutes: 5,
      dwellRadiusM: 100,
      gapMinutes: 10,
    });
    const stays = segs.filter((s) => s.kind === 'stay');
    const trips = segs.filter((s) => s.kind === 'trip');
    // Expect: home stay + outbound trip + gap stay + inferred return trip + home2 stay
    expect(stays).toHaveLength(3);
    expect(trips).toHaveLength(2);
  });

  describe('RULE_GAP_DWELL: power-save GPS dropouts at a stationary place', () => {
    const mpdLat = 111_320;

    it('a multi-hour gap stay is not vetoed by an in_vehicle event at the gap edge', () => {
      // Power-save suppresses GPS for 4h while parked, then the real drive
      // begins — its first in_vehicle event lands just inside the gap window.
      // A single departure event must not erase a 4h stay (the vehicle guard
      // only applies to short gaps, like a tunnel mid-drive).
      const t0 = 1_700_000_000_000;
      const home = { lat: 48.0, lon: 2.0 };
      const pts: RawPoint[] = [];
      // arrival trip into home (moving, ends exactly at home — no dwell cluster)
      pts.push(mkPoint(t0, home.lat - 300 / mpdLat, home.lon));
      pts.push(mkPoint(t0 + 60_000, home.lat - 150 / mpdLat, home.lon));
      const arriveTs = t0 + 120_000;
      pts.push(mkPoint(arriveTs, home.lat, home.lon));
      // 4h gap, then drive away, each fix 200m further north (all moving)
      const resumeTs = arriveTs + 4 * 60 * 60_000;
      for (let i = 0; i <= 8; i++) {
        pts.push(mkPoint(resumeTs + i * 30_000, home.lat + (121 + i * 200) / mpdLat, home.lon));
      }
      const acts: RawActivity[] = [mkActivity(resumeTs - 60_000, 'in_vehicle', 100)];

      const segs = segmentation(pts, acts, {
        dwellMinutes: 5,
        dwellRadiusM: 100,
        gapMinutes: 10,
      });
      // The only possible stay here is the 4h gap stay at home.
      expect(segs.filter((s) => s.kind === 'stay')).toHaveLength(1);
    });

    it('creates a gap stay for a short transit gap that covered real distance despite in_vehicle (metro tunnel)', () => {
      // A 13-min GPS blackout covering ~6.4 km with an in_vehicle event in the
      // window — a metro hop, NOT a stalled car. It must become a gap stay so
      // downstream subway detection can fire. Previously the stalled-vehicle
      // guard (gap < 15 min + in_vehicle) swallowed it, leaving no gap, no line.
      const mpdLat = 111_320;
      const t0 = 1_700_000_000_000;
      const lat0 = 48.0;
      const lon0 = 2.0;
      const pts: RawPoint[] = [];
      // short moving approach (walk toward the station), no 5-min dwell
      for (let i = 0; i < 4; i++) pts.push(mkPoint(t0 + i * 60_000, lat0 + (i * 50) / mpdLat, lon0));
      const gapStartTs = t0 + 3 * 60_000; // last fix before going underground
      const resumeTs = gapStartTs + 13 * 60_000; // 13-min gap
      // resume ~6.4 km away, then keep moving
      for (let i = 0; i <= 5; i++)
        pts.push(mkPoint(resumeTs + i * 60_000, lat0 + (6400 + i * 100) / mpdLat, lon0));
      const acts: RawActivity[] = [mkActivity(gapStartTs + 5 * 60_000, 'in_vehicle', 100)];

      const segs = segmentation(pts, acts, {
        dwellMinutes: 5,
        dwellRadiusM: 100,
        gapMinutes: 10,
      });
      const gapStay = segs.find((s) => s.kind === 'stay' && (s as { gap?: boolean }).gap);
      expect(gapStay).toBeDefined();
    });

    it('still treats a short slow-crawl in_vehicle gap as continuous (traffic stall, not transit)', () => {
      // 12-min gap covering only ~500 m (avg < 1 m/s) with in_vehicle — a vehicle
      // crawling/stopped that briefly lost signal. Must NOT become a gap stay.
      const mpdLat = 111_320;
      const t0 = 1_700_000_000_000;
      const lat0 = 48.0;
      const lon0 = 2.0;
      const pts: RawPoint[] = [];
      for (let i = 0; i < 4; i++) pts.push(mkPoint(t0 + i * 60_000, lat0 + (i * 30) / mpdLat, lon0));
      const gapStartTs = t0 + 3 * 60_000;
      const resumeTs = gapStartTs + 12 * 60_000;
      for (let i = 0; i <= 5; i++)
        pts.push(mkPoint(resumeTs + i * 60_000, lat0 + (500 + i * 30) / mpdLat, lon0));
      const acts: RawActivity[] = [mkActivity(gapStartTs + 5 * 60_000, 'in_vehicle', 100)];

      const segs = segmentation(pts, acts, {
        dwellMinutes: 5,
        dwellRadiusM: 100,
        gapMinutes: 10,
      });
      expect(segs.some((s) => s.kind === 'stay' && (s as { gap?: boolean }).gap)).toBe(false);
    });

    it('a gap stay spans the gap duration instead of collapsing to zero', () => {
      const t0 = 1_700_000_000_000;
      const lat0 = 48.0;
      const lon0 = 2.0;
      const pts: RawPoint[] = [];
      for (let i = 0; i <= 10; i++) pts.push(mkPoint(t0 + i * 60_000, lat0, lon0));
      const walkStart = t0 + 11 * 60_000;
      for (let i = 1; i <= 5; i++) pts.push(mkPoint(walkStart + i * 60_000, lat0 + 0.002 * i, lon0));
      const gapStartTs = walkStart + 5 * 60_000; // last point before signal loss
      const homeAgain = gapStartTs + 2 * 60 * 60_000;
      for (let i = 0; i <= 10; i++) pts.push(mkPoint(homeAgain + i * 60_000, lat0, lon0));

      const segs = segmentation(pts, [], {
        dwellMinutes: 5,
        dwellRadiusM: 100,
        gapMinutes: 10,
      });
      const stays = segs.filter((s) => s.kind === 'stay') as Array<{
        kind: 'stay';
        startMs: number;
        endMs: number;
      }>;
      const gapStay = stays.find((s) => Math.abs(s.startMs - gapStartTs) < 1000);
      expect(gapStay).toBeDefined();
      // Before fix: gap stay is encoded as a single point → zero duration.
      expect(gapStay!.endMs - gapStay!.startMs).toBeGreaterThan(60 * 60_000);
    });

    it('does not reattach a pre-gap point to the trip after the gap', () => {
      // The arrival fix sits ~111m from the post-gap resume fix, so the
      // approach-point reattachment would pull it into the post-gap trip,
      // making that trip start 4h early. A multi-hour gap must block reattach.
      const t0 = 1_700_000_000_000;
      const home = { lat: 48.0, lon: 2.0 };
      const pts: RawPoint[] = [];
      pts.push(mkPoint(t0, home.lat - 300 / mpdLat, home.lon));
      pts.push(mkPoint(t0 + 60_000, home.lat - 150 / mpdLat, home.lon));
      const arriveTs = t0 + 120_000;
      pts.push(mkPoint(arriveTs, home.lat, home.lon));
      const resumeTs = arriveTs + 4 * 60 * 60_000;
      // drive north from 111m away to a destination, then dwell there
      for (let i = 0; i <= 8; i++) {
        pts.push(mkPoint(resumeTs + i * 30_000, home.lat + (111 + i * 200) / mpdLat, home.lon));
      }
      const destLat = home.lat + (111 + 8 * 200) / mpdLat;
      const cArr = resumeTs + 8 * 30_000;
      for (let i = 1; i <= 8; i++) pts.push(mkPoint(cArr + i * 60_000, destLat, home.lon));

      const segs = segmentation(pts, [], {
        dwellMinutes: 5,
        dwellRadiusM: 100,
        gapMinutes: 10,
      });
      const trips = segs.filter((s) => s.kind === 'trip') as Array<{
        kind: 'trip';
        points: RawPoint[];
      }>;
      // No trip may straddle the 4h gap.
      for (const tr of trips) {
        const dur =
          tr.points[tr.points.length - 1]!.timestampMs - tr.points[0]!.timestampMs;
        expect(dur).toBeLessThan(60 * 60_000);
      }
    });
  });
});
