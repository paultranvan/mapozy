import { splitFlightRuns } from '../flightSplit';
import { mkPoint, resetIds } from './_fixtures';

const T0 = 1_700_000_000_000;

describe('splitFlightRuns', () => {
  beforeEach(() => resetIds());

  it('returns a single ground run for fewer than two points', () => {
    const runs = splitFlightRuns([mkPoint(T0, 45, 5)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.isFlight).toBe(false);
  });

  it('leaves a normal drive untouched (no flight runs)', () => {
    // ~20 m/s steps — well under the flight threshold.
    const pts = [0, 1, 2, 3, 4].map((i) =>
      mkPoint(T0 + i * 60_000, 45 + 0.01 * i, 5)
    );
    const runs = splitFlightRuns(pts);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.isFlight).toBe(false);
  });

  it('carves a single long hop into its own flight run (ground/flight/ground)', () => {
    const pts = [
      mkPoint(T0, 45.0, 5.0),
      mkPoint(T0 + 60_000, 45.001, 5.0), // slow
      mkPoint(T0 + 120_000, 45.002, 5.0), // slow — end of ground A
      mkPoint(T0 + 120_000 + 3_600_000, 53.0, 5.0), // ~888 km in 1 h ≈ 247 m/s
      mkPoint(T0 + 120_000 + 3_660_000, 53.001, 5.0), // slow
      mkPoint(T0 + 120_000 + 3_720_000, 53.002, 5.0), // slow — ground B
    ];
    const runs = splitFlightRuns(pts);
    expect(runs.map((r) => r.isFlight)).toEqual([false, true, false]);
    // Flight run is the hop's two endpoints, shared with the ground runs.
    const flight = runs[1]!;
    expect(flight.points).toHaveLength(2);
    expect(flight.points[0]!.latitude).toBe(45.002);
    expect(flight.points[1]!.latitude).toBe(53.0);
  });

  it('merges consecutive in-flight fixes into one flight run', () => {
    const pts = [
      mkPoint(T0, 45.0, 5.0),
      mkPoint(T0 + 60_000, 45.001, 5.0), // slow — ground A
      mkPoint(T0 + 660_000, 46.0, 5.0), // ~111 km in 600 s ≈ 185 m/s
      mkPoint(T0 + 1_260_000, 47.0, 5.0), // fast
      mkPoint(T0 + 1_860_000, 48.0, 5.0), // fast
      mkPoint(T0 + 1_920_000, 48.001, 5.0), // slow — ground B
    ];
    const runs = splitFlightRuns(pts);
    expect(runs.map((r) => r.isFlight)).toEqual([false, true, false]);
    // One merged flight run carries all the cruise fixes (+ shared endpoints).
    expect(runs[1]!.points.length).toBe(4);
  });

  it('rejects an out-and-back spike whose net displacement is small', () => {
    const pts = [
      mkPoint(T0, 45.0, 5.0),
      mkPoint(T0 + 60_000, 45.0005, 5.0), // slow
      mkPoint(T0 + 62_000, 47.0, 5.0), // huge jump out (spike)
      mkPoint(T0 + 64_000, 45.0006, 5.0), // huge jump back
      mkPoint(T0 + 124_000, 45.001, 5.0), // slow
    ];
    const runs = splitFlightRuns(pts);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.isFlight).toBe(false);
  });
});
