import { sectionSegmentation } from '../sectionSegmentation';
import { mkPoint, mkActivity, resetIds } from './_fixtures';

describe('sectionSegmentation', () => {
  beforeEach(() => resetIds());

  it('splits into 3 sections when activity changes twice', () => {
    const pts = [];
    for (let i = 0; i <= 18; i++) pts.push(mkPoint(i * 30_000, 0, 0));
    const acts = [
      mkActivity(0, 'walking'),
      mkActivity(60_000, 'walking'),
      // transition at 180s → in_vehicle, lasts 5 samples (150s) so >= 30s threshold
      mkActivity(180_000, 'in_vehicle'),
      mkActivity(210_000, 'in_vehicle'),
      mkActivity(240_000, 'in_vehicle'),
      mkActivity(270_000, 'in_vehicle'),
      mkActivity(300_000, 'in_vehicle'),
      // back to walking
      mkActivity(330_000, 'walking'),
      mkActivity(360_000, 'walking'),
    ];
    const sections = sectionSegmentation(pts, acts);
    expect(sections.map((s) => s.activity)).toEqual(['walking', 'in_vehicle', 'walking']);
  });

  it('recovers a departure activity that precedes the first GPS fix (trip-start lag)', () => {
    // The activity recogniser flags in_vehicle at the moment of departure, but
    // the GPS trip only "starts" once the vehicle clears the dwell radius —
    // a couple of minutes later. The trip must still pick up that departure
    // activity instead of falling back to unknown (RULE_SECTION_ACTIVITY_WINDOW).
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push(mkPoint(180_000 + i * 30_000, 0, 0));
    const acts = [mkActivity(60_000, 'in_vehicle')]; // 2 min before first fix
    const sections = sectionSegmentation(pts, acts);
    expect(sections[0]!.activity).toBe('in_vehicle');
  });

  it('moves vehicle-speed points off the tail of a walk section when the in_vehicle activity lags', () => {
    // Real-world drop-off pattern: the activity recogniser flags in_vehicle a
    // beat late, so the walk section absorbs the first fixes of the drive —
    // including a fast departure step (8 m/s) immediately followed by a slow
    // traffic-light crawl (0.5 m/s). The crawl must NOT keep those points in
    // the walk section: the boundary belongs where GPS shows the car pulled
    // away (RULE_WALK_SPEED_BOUNDARY), not where the activity finally flipped.
    const lon = (mps: number, prev: number) => prev + (mps * 30) / 111_320;
    let x = 0;
    const lons = [
      (x = 0), // p0
      (x = lon(1.5, x)), // p1 walk
      (x = lon(1.5, x)), // p2 walk
      (x = lon(1.5, x)), // p3 walk — last genuine on-foot fix
      (x = lon(8.0, x)), // p4 car pulls away (fast)
      (x = lon(0.5, x)), // p5 stopped at the light (slow, but already driving)
      (x = lon(8.0, x)), // p6 car
      (x = lon(8.0, x)), // p7 car
      (x = lon(8.0, x)), // p8 car
    ];
    const pts = lons.map((l, i) => mkPoint(i * 30_000, 0, l));
    const acts = [
      mkActivity(0, 'walking'),
      mkActivity(30_000, 'walking'),
      mkActivity(60_000, 'walking'),
      mkActivity(90_000, 'walking'),
      mkActivity(120_000, 'walking'), // lag: still "walking" while car already moving
      mkActivity(150_000, 'walking'), // lag continues through the traffic crawl
      mkActivity(180_000, 'in_vehicle'),
      mkActivity(210_000, 'in_vehicle'),
      mkActivity(240_000, 'in_vehicle'),
    ];
    const sections = sectionSegmentation(pts, acts);
    expect(sections.map((s) => s.activity)).toEqual(['walking', 'in_vehicle']);
    expect(sections[0]!.endMs).toBe(90_000); // walk ends at the last on-foot fix
    expect(sections[1]!.startMs).toBe(120_000); // vehicle owns the departure onward
  });

  it('leaves a walk section intact when it is not followed by a faster section', () => {
    // A fast step inside a walk that stays a walk (no vehicle/bike/run after)
    // must not be split — the guard only re-homes fixes into a faster
    // successor, so it can never invent a vehicle leg out of GPS noise.
    const lon = (mps: number, prev: number) => prev + (mps * 30) / 111_320;
    let x = 0;
    const lons = [
      (x = 0),
      (x = lon(1.5, x)),
      (x = lon(8.0, x)), // a single fast jump mid-walk
      (x = lon(1.5, x)),
      (x = lon(1.5, x)),
    ];
    const pts = lons.map((l, i) => mkPoint(i * 30_000, 0, l));
    const acts = [
      mkActivity(0, 'walking'),
      mkActivity(60_000, 'walking'),
      mkActivity(120_000, 'walking'),
    ];
    const sections = sectionSegmentation(pts, acts);
    expect(sections.map((s) => s.activity)).toEqual(['walking']);
    expect(sections[0]!.points).toHaveLength(5);
  });

  it('merges sections shorter than minSection into the previous', () => {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push(mkPoint(i * 30_000, 0, 0));
    const acts = [
      mkActivity(0, 'walking'),
      mkActivity(60_000, 'walking'),
      mkActivity(90_000, 'in_vehicle'), // very short blip
      mkActivity(120_000, 'walking'),
      mkActivity(150_000, 'walking'),
    ];
    const sections = sectionSegmentation(pts, acts);
    // The 'in_vehicle' blip should be merged because it's < 30s.
    expect(sections.length).toBeLessThanOrEqual(2);
  });
});
