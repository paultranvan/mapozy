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
