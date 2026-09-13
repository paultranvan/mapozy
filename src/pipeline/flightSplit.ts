// Rule implemented here: RULE_FLIGHT (see ./rules.ts).
//
// Splits a leg's raw points into contiguous ground/flight runs — gate to gate
// (taxi phases included) when the leg holds a flight. Must run on
// raw (smoothed) points BEFORE resample: resample interpolates a multi-hour
// airborne gap into thousands of fake slow points, destroying the speed signal.
// Adjacent runs share their boundary point so the trip polyline stays
// continuous and the flight section spans exactly the hop's endpoints.
import type { RawPoint } from '../types';
import type { RawSection } from './sectionSegmentation';
import { haversineMeters } from '../lib/distance';
import { RULES } from './rules';

export interface FlightRun {
  points: RawPoint[];
  isFlight: boolean;
}

function stepSpeedMps(a: RawPoint, b: RawPoint): number {
  const dt = (b.timestampMs - a.timestampMs) / 1000;
  if (dt <= 0) return 0;
  return haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude) / dt;
}

export function splitFlightRuns(points: RawPoint[]): FlightRun[] {
  const { flightSpeedMps, extendSpeedMps, minFlightDistanceM, maxTaxiMinutes } =
    RULES.FLIGHT.defaults;
  if (points.length < 2) {
    return [{ points: [...points], isFlight: false }];
  }

  // Per-step flight flag by speed…
  const speed = new Array<number>(points.length - 1);
  const flight = new Array<boolean>(points.length - 1);
  for (let k = 0; k < points.length - 1; k++) {
    speed[k] = stepSpeedMps(points[k]!, points[k + 1]!);
    flight[k] = speed[k]! > flightSpeedMps;
  }

  // …then demote any contiguous fast group whose net first→last displacement
  // is too small to be travel (out-and-back GPS spikes).
  for (let k = 0; k < flight.length; ) {
    if (!flight[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < flight.length && flight[e + 1]) e++;
    const net = haversineMeters(
      points[k]!.latitude,
      points[k]!.longitude,
      points[e + 1]!.latitude,
      points[e + 1]!.longitude
    );
    if (net <= minFlightDistanceM) {
      for (let j = k; j <= e; j++) flight[j] = false;
    }
    k = e + 1;
  }

  // …then grow each surviving flight group outward over the climb-out and
  // approach: contiguous steps slower than cruise but faster than any taxi.
  for (let k = 0; k < flight.length; ) {
    if (!flight[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < flight.length && flight[e + 1]) e++;
    for (let j = k - 1; j >= 0 && !flight[j] && speed[j]! > extendSpeedMps; j--) {
      flight[j] = true;
    }
    for (let j = e + 1; j < flight.length && !flight[j] && speed[j]! > extendSpeedMps; j++) {
      flight[j] = true;
      e = j;
    }
    k = e + 1;
  }

  // …then make the flight gate-to-gate: anything between the first and last
  // flight step of the leg is airborne, and the slow edge runs (taxi out /
  // taxi in) join too unless they are too long to be a taxi.
  const first = flight.indexOf(true);
  if (first !== -1) {
    const last = flight.lastIndexOf(true);
    for (let j = first + 1; j < last; j++) flight[j] = true;
    const maxTaxiMs = maxTaxiMinutes * 60_000;
    if (points[first]!.timestampMs - points[0]!.timestampMs <= maxTaxiMs) {
      for (let j = 0; j < first; j++) flight[j] = true;
    }
    const n = points.length - 1;
    if (points[n]!.timestampMs - points[last + 1]!.timestampMs <= maxTaxiMs) {
      for (let j = last + 1; j < flight.length; j++) flight[j] = true;
    }
  }

  // Emit one run per maximal same-flag step group; consecutive runs share the
  // boundary point (group i ends at points[e+1], group i+1 starts there).
  const runs: FlightRun[] = [];
  for (let k = 0; k < flight.length; ) {
    const isFlight = flight[k]!;
    let e = k;
    while (e + 1 < flight.length && flight[e + 1] === isFlight) e++;
    runs.push({ points: points.slice(k, e + 2), isFlight });
    k = e + 1;
  }
  return runs;
}

// A flight run becomes a section directly (no resample — we keep the actual
// fixes), with mode pre-set so assemble() does not re-infer it from the
// airport-endpoint ground speeds.
export function buildFlightSection(points: RawPoint[]): RawSection {
  return {
    activity: 'unknown',
    points,
    startMs: points[0]!.timestampMs,
    endMs: points[points.length - 1]!.timestampMs,
    mode: 'plane',
  };
}
