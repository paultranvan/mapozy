import { haversineMeters, pathLengthMeters, pointToPolylineMeters, coverageFraction } from '../distance';

describe('distance', () => {
  it('haversine: zero for same point', () => {
    expect(haversineMeters(45, 4, 45, 4)).toBe(0);
  });

  it('haversine: ~111km for 1 degree latitude', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -3);
  });

  it('haversine: small distance between close points', () => {
    // ~100m east at lat 45
    const d = haversineMeters(45, 0, 45, 0.00127);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });

  it('pathLength: sums consecutive segments', () => {
    const len = pathLengthMeters([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(len).toBeCloseTo(222_390, -3);
  });

  it('pathLength: zero for less than two points', () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([[1, 2]])).toBe(0);
  });
});

// Coordinates are [lon, lat]. At lat 45, 0.001 deg lat ≈ 111.3 m;
// 0.001 deg lon ≈ 78.7 m.
const lat0 = 45.0;
const lon0 = 5.0;
const line: Array<[number, number]> = [
  [lon0, lat0],
  [lon0 + 0.01, lat0], // ~787 m due east
];

describe('pointToPolylineMeters', () => {
  it('is ~0 for a point on the line', () => {
    expect(pointToPolylineMeters([lon0 + 0.005, lat0], line)).toBeLessThan(1);
  });

  it('measures perpendicular offset (~100 m north of mid-line)', () => {
    // 0.0009 deg lat ≈ 100.2 m
    const d = pointToPolylineMeters([lon0 + 0.005, lat0 + 0.0009], line);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(106);
  });

  it('clamps to the nearest endpoint when the point is past the end', () => {
    // 0.002 deg lon east of the end ≈ 157 m
    const d = pointToPolylineMeters([lon0 + 0.012, lat0], line);
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(165);
  });

  it('returns Infinity for an empty line', () => {
    expect(pointToPolylineMeters([lon0, lat0], [])).toBe(Infinity);
  });

  it('handles a single-point polyline', () => {
    const d = pointToPolylineMeters([lon0 + 0.001, lat0], [[lon0, lat0]]);
    expect(d).toBeGreaterThan(70); // ~78 m at lat 45
    expect(d).toBeLessThan(85);
  });
});

describe('coverageFraction', () => {
  const coords: Array<[number, number]> = [
    [lon0 + 0.001, lat0],
    [lon0 + 0.003, lat0],
    [lon0 + 0.005, lat0],
    [lon0 + 0.007, lat0],
  ];

  it('is 1.0 when every point is within the buffer of the line', () => {
    expect(coverageFraction(coords, [line], 25)).toBeCloseTo(1.0, 5);
  });

  it('is 0.0 when the line is far away', () => {
    const farLine: Array<[number, number]> = [
      [lon0, lat0 + 0.01], // ~1.1 km north
      [lon0 + 0.01, lat0 + 0.01],
    ];
    expect(coverageFraction(coords, [farLine], 25)).toBe(0);
  });

  it('counts a point within the buffer of ANY supplied line', () => {
    // lat0 + 0.002 ≈ 222 m north of `line` — outside line's 25 m buffer
    const farCoords: Array<[number, number]> = [
      [lon0 + 0.001, lat0],          // on `line`
      [lon0 + 0.003, lat0],          // on `line`
      [lon0 + 0.005, lat0],          // on `line`
      [lon0 + 0.008, lat0 + 0.002],  // ~222 m north — outside `line`'s buffer
    ];
    const nearLine: Array<[number, number]> = [
      [lon0 + 0.007, lat0 + 0.002],  // ~11 m from farCoords[3]
      [lon0 + 0.009, lat0 + 0.002],
    ];
    // 3 of 4 lie on `line`; the 4th lies near `nearLine` only.
    expect(coverageFraction(farCoords, [line, nearLine], 25)).toBeCloseTo(1.0, 5);
  });

  it('is 0 with no lines', () => {
    expect(coverageFraction(coords, [], 25)).toBe(0);
  });
});
