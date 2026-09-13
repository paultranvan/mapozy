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
    // Ground edges last 1 h each — longer than the taxi cap, so they stay ground.
    const H = 3_600_000;
    const pts = [
      mkPoint(T0, 45.0, 5.0),
      mkPoint(T0 + H / 2, 45.001, 5.0), // slow
      mkPoint(T0 + H, 45.002, 5.0), // slow — end of ground A
      mkPoint(T0 + 2 * H, 53.0, 5.0), // ~888 km in 1 h ≈ 247 m/s
      mkPoint(T0 + 2.5 * H, 53.001, 5.0), // slow
      mkPoint(T0 + 3 * H, 53.002, 5.0), // slow — ground B
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
    const H = 3_600_000;
    const pts = [
      mkPoint(T0, 45.0, 5.0),
      mkPoint(T0 + H, 45.001, 5.0), // slow, 1 h — ground A (past the taxi cap)
      mkPoint(T0 + H + 600_000, 46.0, 5.0), // ~111 km in 600 s ≈ 185 m/s
      mkPoint(T0 + H + 1_200_000, 47.0, 5.0), // fast
      mkPoint(T0 + H + 1_800_000, 48.0, 5.0), // fast
      mkPoint(T0 + 2 * H + 1_800_000, 48.001, 5.0), // slow, 1 h — ground B
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

describe('splitFlightRuns — climb-out and approach', () => {
  beforeEach(() => resetIds());

  // 2026-09-08 CDG→BCN: the single 110 m/s threshold left the climb (280→400
  // km/h) and the descent (394→270 km/h) as ground runs, which the speed
  // classifier then labelled car / train (a "train" in the middle of the sea).
  // Ground edges last 1 h so only the speed-based extension is under test.
  const H = 3_600_000;
  const climb = [
    mkPoint(T0, 45.0, 5.0),
    mkPoint(T0 + H, 45.0005, 5.0), // slow, 1 h
    mkPoint(T0 + H + 600_000, 45.3, 5.0), // ~33 km in 600 s ≈ 55 m/s — climb
    mkPoint(T0 + H + 1_200_000, 46.3, 5.0), // ~111 km ≈ 185 m/s — cruise
    mkPoint(T0 + H + 1_800_000, 47.3, 5.0), // cruise
    mkPoint(T0 + H + 2_400_000, 47.6, 5.0), // ~33 km ≈ 55 m/s — approach
    mkPoint(T0 + 2 * H + 2_400_000, 47.6005, 5.0), // slow, 1 h
  ];

  it('extends a flight run over adjacent steps above the extend threshold', () => {
    const runs = splitFlightRuns(climb);
    expect(runs.map((r) => r.isFlight)).toEqual([false, true, false]);
    const flight = runs[1]!;
    expect(flight.points.map((p) => p.latitude)).toEqual([
      45.0005, 45.3, 46.3, 47.3, 47.6,
    ]);
  });

  it('does not extend over adjacent steps at road speed', () => {
    const pts = [...climb];
    // Replace climb/approach with ~18 km in 600 s ≈ 30 m/s (a fast road).
    pts[2] = mkPoint(T0 + H + 600_000, 45.16, 5.0);
    pts[5] = mkPoint(T0 + H + 2_400_000, 47.46, 5.0);
    const runs = splitFlightRuns(pts);
    expect(runs.map((r) => r.isFlight)).toEqual([false, true, false]);
    expect(runs[1]!.points.map((p) => p.latitude)).toEqual([45.16, 46.3, 47.3]);
  });

  it('does not extend a demoted spike group', () => {
    const pts = [
      mkPoint(T0, 45.0, 5.0),
      mkPoint(T0 + 600_000, 45.3, 5.0), // 55 m/s step next to the spike
      mkPoint(T0 + 602_000, 47.0, 5.0), // spike out
      mkPoint(T0 + 604_000, 45.3006, 5.0), // spike back
      mkPoint(T0 + 1_204_000, 45.6, 5.0), // 55 m/s
    ];
    const runs = splitFlightRuns(pts);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.isFlight).toBe(false);
  });
});

describe('splitFlightRuns — gate-to-gate taxi', () => {
  beforeEach(() => resetIds());

  // A leg is bounded by stops, and the stop at the gate (boarding wait
  // included) ends at pushback. Slow ground steps at the leg's edges next to
  // a flight are the aircraft taxiing: gate → runway and runway → gate.
  const gateToGate = [
    mkPoint(T0, 45.0, 5.0),
    mkPoint(T0 + 300_000, 45.002, 5.0), // taxi out, 5 min
    mkPoint(T0 + 600_000, 45.004, 5.0), // taxi out — end of ground A
    mkPoint(T0 + 1_200_000, 46.0, 5.0), // ~110 km in 600 s ≈ 184 m/s
    mkPoint(T0 + 1_800_000, 47.0, 5.0), // cruise
    mkPoint(T0 + 2_100_000, 47.002, 5.0), // taxi in, 5 min
    mkPoint(T0 + 2_400_000, 47.004, 5.0), // taxi in — gate
  ];

  it('absorbs short ground runs at both edges of the leg into the flight', () => {
    const runs = splitFlightRuns(gateToGate);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.isFlight).toBe(true);
    expect(runs[0]!.points).toHaveLength(gateToGate.length);
  });

  it('leaves an edge ground run longer than the taxi cap alone', () => {
    const pts = [...gateToGate];
    // Stretch ground A to 50 min: not a taxi, keep it as its own run.
    pts[0] = mkPoint(T0 - 2_400_000, 45.0, 5.0);
    const runs = splitFlightRuns(pts);
    expect(runs.map((r) => r.isFlight)).toEqual([false, true]);
    expect(runs[0]!.points).toHaveLength(3);
    expect(runs[1]!.points[0]!.latitude).toBe(45.004);
  });

  it('absorbs a slow run sandwiched between two flight runs', () => {
    const H = 3_600_000;
    const pts = [
      mkPoint(T0, 45.0, 5.0),
      mkPoint(T0 + H, 45.001, 5.0), // slow, 1 h (past cap)
      mkPoint(T0 + H + 600_000, 46.0, 5.0), // cruise
      mkPoint(T0 + H + 1_200_000, 47.0, 5.0), // cruise
      mkPoint(T0 + H + 1_800_000, 47.05, 5.0), // ~5.5 km in 600 s ≈ 9 m/s — holding
      mkPoint(T0 + H + 2_400_000, 48.0, 5.0), // cruise again
      mkPoint(T0 + H + 3_000_000, 49.0, 5.0), // cruise
      mkPoint(T0 + 2 * H + 3_000_000, 49.001, 5.0), // slow, 1 h (past cap)
    ];
    const runs = splitFlightRuns(pts);
    expect(runs.map((r) => r.isFlight)).toEqual([false, true, false]);
    expect(runs[1]!.points).toHaveLength(6);
  });
});
