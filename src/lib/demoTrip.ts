import type { Db } from '../db/client';
import { insertRawPoint } from '../db/rawPoints';
import { insertRawActivity } from '../db/rawActivities';
import { runPipeline } from '../pipeline/runPipeline';
import type { ActivityType } from '../types';

/**
 * Generates and inserts raw GPS + activity samples representing a multi-mode
 * trip (walk → drive → walk) around Lyon, then runs the pipeline.
 *
 * Used from the Settings screen for emulator validation.
 */
const DEMO_OFFSET_DAYS = 7;

export async function injectDemoTrip(
  db: Db,
  baseTimeMs = Date.now() - DEMO_OFFSET_DAYS * 24 * 60 * 60_000
): Promise<void> {
  const lat0 = 45.764;
  const lon0 = 4.8357;

  let id = 0;
  const pushPoint = async (
    t: number,
    lat: number,
    lon: number,
    accuracy = 5
  ) => {
    await insertRawPoint(db, {
      timestampMs: t,
      latitude: lat,
      longitude: lon,
      altitude: 200,
      accuracyMeters: accuracy,
      speedMps: null,
      bearingDeg: null,
      batteryLevel: 0.9,
      isCharging: false,
    });
    id++;
  };
  const pushAct = (t: number, type: ActivityType, confidence = 90) =>
    insertRawActivity(db, { timestampMs: t, type, confidence });

  // Stay at A (home) for 10 minutes
  for (let i = 0; i <= 10; i++) {
    await pushPoint(baseTimeMs + i * 60_000, lat0, lon0);
  }
  await pushAct(baseTimeMs + 60_000, 'still');
  await pushAct(baseTimeMs + 5 * 60_000, 'still');

  // Walk east ~200m over 4 min, 1 point per 30s
  const walkStart = baseTimeMs + 11 * 60_000;
  for (let i = 0; i <= 8; i++) {
    await pushPoint(walkStart + i * 30_000, lat0, lon0 + 0.0003 * i);
  }
  for (let i = 0; i < 8; i++) {
    await pushAct(walkStart + i * 30_000, 'walking');
  }

  // Drive ~2km north over 3 min
  const driveStart = walkStart + 8 * 30_000 + 1000;
  for (let i = 0; i <= 6; i++) {
    const f = i / 6;
    await pushPoint(
      driveStart + i * 30_000,
      lat0 + 0.018 * f,
      lon0 + 0.0024
    );
  }
  for (let i = 0; i < 6; i++) {
    await pushAct(driveStart + i * 30_000, 'in_vehicle');
  }

  // Walk west ~200m over 4 min
  const driveLat = lat0 + 0.018;
  const walk2Start = driveStart + 6 * 30_000 + 1000;
  for (let i = 0; i <= 8; i++) {
    await pushPoint(walk2Start + i * 30_000, driveLat, lon0 + 0.0024 - 0.0003 * i);
  }
  for (let i = 0; i < 8; i++) {
    await pushAct(walk2Start + i * 30_000, 'walking');
  }

  // Stay at B (work) for 10 minutes
  const stayB = walk2Start + 8 * 30_000 + 1000;
  for (let i = 0; i <= 10; i++) {
    await pushPoint(stayB + i * 60_000, driveLat, lon0);
  }
  await pushAct(stayB + 60_000, 'still');
  await pushAct(stayB + 5 * 60_000, 'still');

  const upTo = stayB + 11 * 60_000;
  await runPipeline(db, { upToMs: upTo, nowMs: upTo });
}
