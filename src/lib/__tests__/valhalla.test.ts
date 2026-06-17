import { decodePolyline, mapMatch } from '../valhalla';

function fakeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  return {
    status: init.status ?? 200,
    ok: init.ok ?? true,
    json: async () => body,
  } as unknown as Response;
}

// Reference encoder (Google/Valhalla algorithm) so we can round-trip the
// decoder against known coordinates at precision 6.
function encodePolyline(coords: Array<[number, number]>, precision = 6): string {
  const factor = Math.pow(10, precision);
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  const enc = (v: number) => {
    let val = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (val >= 0x20) {
      s += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
      val >>= 5;
    }
    s += String.fromCharCode(val + 63);
    return s;
  };
  for (const [lon, lat] of coords) {
    const latE = Math.round(lat * factor);
    const lngE = Math.round(lon * factor);
    out += enc(latE - lastLat) + enc(lngE - lastLng);
    lastLat = latE;
    lastLng = lngE;
  }
  return out;
}

const deps = (fetchFn: typeof fetch) => ({ fetchFn, minIntervalMs: 0 });

describe('decodePolyline', () => {
  it('round-trips coordinates at precision 6', () => {
    const coords: Array<[number, number]> = [
      [2.2581, 48.8372],
      [2.2596, 48.8381],
      [2.2604, 48.8395],
    ];
    const decoded = decodePolyline(encodePolyline(coords));
    expect(decoded).toHaveLength(coords.length);
    decoded.forEach(([lon, lat], i) => {
      expect(lon).toBeCloseTo(coords[i]![0], 5);
      expect(lat).toBeCloseTo(coords[i]![1], 5);
    });
  });
});

describe('mapMatch', () => {
  const trace: Array<[number, number]> = [
    [2.2581, 48.8372],
    [2.2596, 48.8381],
  ];
  const snapped: Array<[number, number]> = [
    [2.2582, 48.8373],
    [2.2597, 48.8382],
  ];

  it('returns decoded snapped geometry and confidence on success', async () => {
    const fetchFn = jest.fn(async () =>
      fakeResponse({ shape: encodePolyline(snapped), confidence_score: 0.92 })
    ) as unknown as typeof fetch;
    const res = await mapMatch(deps(fetchFn), trace, 'pedestrian');
    expect(res).not.toBeNull();
    expect(res!.confidence).toBe(0.92);
    expect(res!.coords).toHaveLength(2);
    expect(res!.coords[0]![0]).toBeCloseTo(snapped[0]![0], 5);
  });

  it('reports null confidence when the API omits the score', async () => {
    const fetchFn = jest.fn(async () =>
      fakeResponse({ shape: encodePolyline(snapped) })
    ) as unknown as typeof fetch;
    const res = await mapMatch(deps(fetchFn), trace, 'auto');
    expect(res!.confidence).toBeNull();
  });

  it('returns null on a non-ok response (e.g. no snappable edges)', async () => {
    const fetchFn = jest.fn(async () =>
      fakeResponse({ error: 'No suitable edges' }, { status: 400, ok: false })
    ) as unknown as typeof fetch;
    expect(await mapMatch(deps(fetchFn), trace, 'auto')).toBeNull();
  });

  it('returns null when the network throws (offline)', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await mapMatch(deps(fetchFn), trace, 'bicycle')).toBeNull();
  });

  it('returns null for a degenerate single-point trace without fetching', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    expect(await mapMatch(deps(fetchFn), [trace[0]!], 'auto')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
