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
