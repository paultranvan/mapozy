import {
  classifyAirportHop,
  classifyOpenWater,
  longestHop,
  openWaterStats,
  shoreSide,
} from '../classifySection';
import type { AerowayWay, ShoreWay } from '../../../lib/overpass';
import { mkPoint, resetIds } from '../../__tests__/_fixtures';

// Everything sits in one 0.05° cache tile (lon 5.00-5.05, lat 45.00-45.05).
// At this latitude 0.001° is ~79 m of longitude and ~111 m of latitude.

// A square island, drawn counter-clockwise: land (inside) on the left.
const island: ShoreWay = {
  id: 1,
  kind: 'coastline',
  coords: [
    [5.02, 45.02],
    [5.03, 45.02],
    [5.03, 45.03],
    [5.02, 45.03],
    [5.02, 45.02],
  ],
};

// A second, smaller island to the east of the first.
const islet: ShoreWay = {
  id: 2,
  kind: 'coastline',
  coords: [
    [5.04, 45.024],
    [5.044, 45.024],
    [5.044, 45.026],
    [5.04, 45.026],
    [5.04, 45.024],
  ],
};

// A bridge leaving the island's east shore along lat 45.025.
const bridge: ShoreWay = {
  id: 3,
  kind: 'crossing',
  coords: [
    [5.03, 45.025],
    [5.04, 45.025],
  ],
};

describe('shoreSide', () => {
  it('tells land from sea around an island', () => {
    expect(shoreSide([5.025, 45.025], [island])).toBe('land');
    expect(shoreSide([5.035, 45.025], [island])).toBe('sea');
    expect(shoreSide([5.01, 45.01], [island])).toBe('sea');
    expect(shoreSide([5.025, 45.04], [island])).toBe('sea');
  });

  it('stays right when the nearest coast belongs to another landmass', () => {
    // The islet's interior: closer to the islet's own shore, but the line to
    // any sea reference has to cross a coast exactly once.
    expect(shoreSide([5.042, 45.025], [island, islet])).toBe('land');
    // The channel between the two: sea, whichever shore is nearer.
    expect(shoreSide([5.032, 45.025], [island, islet])).toBe('sea');
    expect(shoreSide([5.038, 45.025], [island, islet])).toBe('sea');
  });

  it('follows the land-on-the-left convention on an open stretch of coast', () => {
    // Mainland coast running north along lon 5.02: land to the west.
    const coast: ShoreWay = {
      id: 4,
      kind: 'coastline',
      coords: Array.from({ length: 11 }, (_, i) => [5.02, 45.0 + i * 0.005] as [number, number]),
    };
    expect(shoreSide([5.01, 45.025], [coast])).toBe('land');
    expect(shoreSide([5.03, 45.025], [coast])).toBe('sea');
  });

  it('is unknown in a tile that holds no coastline', () => {
    // Open sea or far inland: nothing in the tile tells them apart.
    expect(shoreSide([5.2, 45.2], [island])).toBe('unknown');
    expect(shoreSide([5.025, 45.025], [])).toBe('unknown');
  });
});

describe('openWaterStats', () => {
  it('leaves sea points inside the shoreline margin out of both tallies', () => {
    // 40 m off the island's east shore: at sea, but within GPS jitter of land.
    const st = openWaterStats([[5.0305, 45.025]], [island], 100, 30);
    expect(st).toEqual({ sea: 0, land: 0, seaShare: 0 });
  });

  it('counts a point on a bridge or pier as dry ground', () => {
    // 400 m offshore, but on the bridge.
    const onBridge: [number, number] = [5.035, 45.025];
    expect(openWaterStats([onBridge], [island], 100, 30).sea).toBe(1);
    expect(openWaterStats([onBridge], [island, bridge], 100, 30)).toEqual({
      sea: 0,
      land: 1,
      seaShare: 0,
    });
  });

  it('ignores points whose tile has no coastline', () => {
    const st = openWaterStats(
      [
        [5.035, 45.025],
        [5.2, 45.2],
      ],
      [island],
      100,
      30
    );
    expect(st).toEqual({ sea: 1, land: 0, seaShare: 1 });
  });
});

describe('classifyOpenWater', () => {
  // A crossing from the island's south shore out to sea and round to the east:
  // one probe point every ~250 m.
  function crossing(n: number): Array<[number, number]> {
    return Array.from({ length: n }, (_, i) => [5.0345, 45.004 + i * 0.00225] as [number, number]);
  }

  it('classifies a trace lying at sea as boat', () => {
    const cls = classifyOpenWater(crossing(12), [island]);
    expect(cls?.mode).toBe('boat');
    expect(cls?.modeSource).toBe('watermatch');
  });

  it('needs enough open water, not just a majority of the known points', () => {
    // 3 sea points ≈ 750 m: under the 1 km floor.
    expect(classifyOpenWater(crossing(3), [island])).toBeNull();
  });

  it('leaves a trace that is mostly on land alone', () => {
    // Up the island's length, the last fix landing 170 m past its north shore.
    const walk: Array<[number, number]> = Array.from(
      { length: 12 },
      (_, i) => [5.025, 45.0205 + i * 0.001] as [number, number]
    );
    expect(classifyOpenWater(walk, [island])).toBeNull();
  });

  it('leaves a ride across a sea bridge alone', () => {
    const ride: Array<[number, number]> = Array.from(
      { length: 8 },
      (_, i) => [5.0305 + i * 0.0012, 45.025] as [number, number]
    );
    expect(classifyOpenWater(ride, [island, islet, bridge])).toBeNull();
  });
});

describe('longestHop', () => {
  beforeEach(() => resetIds());

  it('returns the longest step between consecutive fixes', () => {
    const fixes = [
      mkPoint(0, 12.0, 120.0),
      mkPoint(60_000, 12.001, 120.0),
      mkPoint(3 * 3600_000, 15.0, 120.5), // ~337 km hop
      mkPoint(3 * 3600_000 + 60_000, 15.001, 120.5),
    ];
    const hop = longestHop(fixes, 100_000);
    expect(hop?.from.timestampMs).toBe(60_000);
    expect(hop?.to.timestampMs).toBe(3 * 3600_000);
  });

  it('returns null when no step reaches the floor', () => {
    const fixes = [mkPoint(0, 12.0, 120.0), mkPoint(3600_000, 12.5, 120.0)]; // ~56 km
    expect(longestHop(fixes, 100_000)).toBeNull();
  });
});

describe('classifyAirportHop', () => {
  const runwayA: AerowayWay = {
    id: 10,
    aeroway: 'runway',
    coords: [
      [120.0, 12.0],
      [120.01, 12.0],
    ],
  };
  const terminalB: AerowayWay = {
    id: 11,
    aeroway: 'terminal',
    coords: [
      [120.5, 15.0],
      [120.501, 15.0],
    ],
  };

  it('is a flight when both ends of the hop are on airport ground', () => {
    const cls = classifyAirportHop([120.002, 12.001], [120.5, 15.002], [runwayA, terminalB]);
    expect(cls?.mode).toBe('plane');
    expect(cls?.modeSource).toBe('station');
  });

  it('is not when only one end is', () => {
    expect(classifyAirportHop([120.002, 12.001], [120.5, 15.002], [runwayA])).toBeNull();
    expect(classifyAirportHop([120.002, 12.001], [120.6, 15.1], [runwayA, terminalB])).toBeNull();
  });
});
