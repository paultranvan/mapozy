export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function pathLengthMeters(coords: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    sum += haversineMeters(a[1], a[0], b[1], b[0]);
  }
  return sum;
}

// Drop `meters` of length off the start of a polyline, linearly interpolating
// the new start point. Used so the trip trace doesn't slide under the start /
// end marker circles.
export function trimLineFromStart(
  coords: Array<[number, number]>,
  meters: number
): Array<[number, number]> {
  if (meters <= 0 || coords.length < 2) return coords;
  let remaining = meters;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const segLen = haversineMeters(a[1], a[0], b[1], b[0]);
    if (segLen >= remaining) {
      const t = remaining / segLen;
      const cut: [number, number] = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      return [cut, ...coords.slice(i)];
    }
    remaining -= segLen;
  }
  return [coords[coords.length - 1]!];
}

export function trimLineFromEnd(
  coords: Array<[number, number]>,
  meters: number
): Array<[number, number]> {
  if (meters <= 0 || coords.length < 2) return coords;
  let remaining = meters;
  for (let i = coords.length - 1; i > 0; i--) {
    const a = coords[i]!;
    const b = coords[i - 1]!;
    const segLen = haversineMeters(a[1], a[0], b[1], b[0]);
    if (segLen >= remaining) {
      const t = remaining / segLen;
      const cut: [number, number] = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      return [...coords.slice(0, i), cut];
    }
    remaining -= segLen;
  }
  return [coords[0]!];
}

// Local flat-earth scale at a reference latitude. Good to well under 1% over
// the ~km spans a single trip section covers — plenty for buffer matching.
function metersPerDegree(refLat: number): { mLat: number; mLon: number } {
  return {
    mLat: 111_320,
    mLon: 111_320 * Math.cos((refLat * Math.PI) / 180),
  };
}

// Distance (m) from point P to segment A–B, via an equirectangular projection
// anchored at A. All coordinates are [lon, lat].
export function pointToSegmentMeters(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const { mLat, mLon } = metersPerDegree(a[1]);
  const px = (p[0] - a[0]) * mLon;
  const py = (p[1] - a[1]) * mLat;
  const bx = (b[0] - a[0]) * mLon;
  const by = (b[1] - a[1]) * mLat;
  const segLenSq = bx * bx + by * by;
  if (segLenSq === 0) return Math.hypot(px, py);
  let t = (px * bx + py * by) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

// Minimum distance (m) from point P=[lon,lat] to a polyline (array of
// [lon,lat]). Infinity for an empty polyline.
export function pointToPolylineMeters(
  p: [number, number],
  line: Array<[number, number]>
): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) {
    const { mLat, mLon } = metersPerDegree(line[0]![1]);
    return Math.hypot((p[0] - line[0]![0]) * mLon, (p[1] - line[0]![1]) * mLat);
  }
  let min = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointToSegmentMeters(p, line[i - 1]!, line[i]!);
    if (d < min) min = d;
  }
  return min;
}

// Fraction of `coords` lying within `bufferM` of ANY of the given polylines.
// Used to decide whether a trace follows a railway line. All [lon,lat].
export function coverageFraction(
  coords: Array<[number, number]>,
  lines: Array<Array<[number, number]>>,
  bufferM: number
): number {
  if (coords.length === 0 || lines.length === 0) return 0;
  let within = 0;
  for (const c of coords) {
    let best = Infinity;
    for (const line of lines) {
      const d = pointToPolylineMeters(c, line);
      if (d < best) best = d;
      if (best <= bufferM) break;
    }
    if (best <= bufferM) within++;
  }
  return within / coords.length;
}
