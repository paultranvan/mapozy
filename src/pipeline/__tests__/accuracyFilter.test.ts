import { accuracyFilter } from '../accuracyFilter';
import { mkPoint, resetIds } from './_fixtures';

describe('accuracyFilter', () => {
  beforeEach(() => resetIds());

  it('drops points above the threshold', () => {
    const pts = [
      { ...mkPoint(1000, 0, 0, 5) },
      { ...mkPoint(2000, 0, 0, 60) },
      { ...mkPoint(3000, 0, 0, 30) },
    ];
    const out = accuracyFilter(pts, { maxAccuracyM: 50 });
    expect(out.map((p) => p.timestampMs)).toEqual([1000, 3000]);
  });

  it('default threshold is 60m', () => {
    const out = accuracyFilter([mkPoint(1000, 0, 0, 60.1)]);
    expect(out).toEqual([]);
  });

  it('default threshold keeps a 60m fix (BALANCED-priority typical)', () => {
    const out = accuracyFilter([mkPoint(1000, 0, 0, 60)]);
    expect(out.map((p) => p.timestampMs)).toEqual([1000]);
  });
});
