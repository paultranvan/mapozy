import { segmentation } from '../segmentation';
import { mkPoint, syntheticTrip, resetIds } from './_fixtures';

describe('segmentation', () => {
  beforeEach(() => resetIds());

  it('returns no trips when fewer than 2 dwell windows', () => {
    // single stay point set
    const pts = [
      mkPoint(0, 45.764, 4.8357),
      mkPoint(60_000, 45.764, 4.8357),
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
});
