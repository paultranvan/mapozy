import {
  aggregateDailyBuckets,
  bucketGranularityFor,
  type DailyBucket,
} from '../periodStats';

const daily = (dayKey: string, km: number, trips = 1): DailyBucket => ({
  dayKey,
  distanceM: km * 1000,
  tripsCount: trips,
});

describe('bucketGranularityFor', () => {
  it('steps granularity up with the period', () => {
    expect(bucketGranularityFor('today')).toBe('day');
    expect(bucketGranularityFor('week')).toBe('day');
    expect(bucketGranularityFor('month')).toBe('week');
    expect(bucketGranularityFor('year')).toBe('month');
    expect(bucketGranularityFor('all')).toBe('year');
  });
});

describe('aggregateDailyBuckets', () => {
  it('day granularity is a passthrough with labels', () => {
    const out = aggregateDailyBuckets([daily('2026-06-23', 5)], 'day');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: '2026-06-23', distanceM: 5000, tripsCount: 1 });
    expect(out[0]!.label).toBe('23 Jun');
  });

  it('year period rolls 365 days into ≤12 month buckets', () => {
    const days: DailyBucket[] = [
      daily('2026-01-05', 1),
      daily('2026-01-20', 2),
      daily('2026-03-02', 4),
      daily('2026-12-31', 8),
    ];
    const out = aggregateDailyBuckets(days, 'month');
    expect(out.map((b) => b.key)).toEqual(['2026-01', '2026-03', '2026-12']);
    expect(out[0]).toMatchObject({ label: 'Jan', distanceM: 3000, tripsCount: 2 });
    expect(out[1]).toMatchObject({ label: 'Mar', distanceM: 4000 });
    expect(out[2]).toMatchObject({ label: 'Dec', distanceM: 8000 });
  });

  it('month period rolls days into Monday-aligned week buckets', () => {
    // 2026-06-23 is a Tuesday → week starts Mon 2026-06-22.
    // 2026-06-21 is a Sunday → previous week starting Mon 2026-06-15.
    const out = aggregateDailyBuckets(
      [daily('2026-06-21', 1), daily('2026-06-23', 2), daily('2026-06-24', 3)],
      'week'
    );
    expect(out.map((b) => b.key)).toEqual(['2026-06-15', '2026-06-22']);
    expect(out[0]).toMatchObject({ distanceM: 1000, label: '15 Jun' });
    expect(out[1]).toMatchObject({ distanceM: 5000, label: '22 Jun' });
  });

  it('all period rolls into year buckets', () => {
    const out = aggregateDailyBuckets(
      [daily('2025-04-01', 1), daily('2026-04-01', 2), daily('2026-08-01', 3)],
      'year'
    );
    expect(out.map((b) => b.key)).toEqual(['2025', '2026']);
    expect(out[1]).toMatchObject({ label: '2026', distanceM: 5000, tripsCount: 2 });
  });
});
