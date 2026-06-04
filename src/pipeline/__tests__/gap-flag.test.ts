import { segmentation } from '../segmentation';
import { mkPoint, resetIds } from './_fixtures';

describe('segmentation — gap flag on stays', () => {
  beforeEach(() => resetIds());

  it('a long tracking gap with a big jump → stay with gap=true', () => {
    const t0 = 1_700_000_000_000;
    const pts = [
      mkPoint(t0, 45.0, 5.0),
      mkPoint(t0 + 15 * 60_000, 45.005, 5.005), // 15 min later, ~650 m away
    ];
    const segs = segmentation(pts, []);
    const stay = segs.find((s) => s.kind === 'stay');
    expect(stay).toBeDefined();
    expect((stay as { gap: boolean }).gap).toBe(true);
  });

  it('a stationary dwell → stay with gap=false', () => {
    const t0 = 1_700_000_000_000;
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push(mkPoint(t0 + i * 60_000, 45.0, 5.0));
    const segs = segmentation(pts, []);
    const stay = segs.find((s) => s.kind === 'stay');
    expect(stay).toBeDefined();
    expect((stay as { gap: boolean }).gap).toBe(false);
  });
});
