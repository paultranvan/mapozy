import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { MapozyTracker } from 'mapozy-tracker';
import { useDb } from '../db/DbContext';
import { getSetting, SETTING_KEYS } from '../db/settings';
import { countPointsSince } from '../db/rawPoints';
import { deriveHealth, HealthSnapshot } from './health';

const POLL_MS = 10_000;

function startOfTodayMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface TrackingHealth {
  snapshot: HealthSnapshot | null;
  pointsToday: number;
  refresh: () => Promise<void>;
}

export function useTrackingHealth(): TrackingHealth {
  const db = useDb();
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [pointsToday, setPointsToday] = useState<number>(0);
  const mountedRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (!db) return;
    const now = Date.now();
    const [status, enabledRaw, restartedRaw, pts] = await Promise.all([
      MapozyTracker.getStatus(),
      getSetting(db, SETTING_KEYS.TRACKING_ENABLED),
      getSetting(db, SETTING_KEYS.LAST_AUTO_RESTART_AT),
      countPointsSince(db, startOfTodayMs(now)),
    ]);
    const restartedNum = restartedRaw != null ? Number(restartedRaw) : null;
    const snap = deriveHealth(
      {
        trackingEnabledSetting: enabledRaw === '1',
        isTracking: !!status.isTracking,
        lastLocationAt: status.lastLocationAt ?? null,
        lastActivityAt: status.lastActivityAt ?? null,
        lastArSilenceDetectedAt: status.lastArSilenceDetectedAt ?? null,
        lastAutoRestartAt:
          restartedNum != null && Number.isFinite(restartedNum)
            ? restartedNum
            : null,
      },
      now
    );
    if (!mountedRef.current) return;
    setSnapshot(snap);
    setPointsToday(pts);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      void fetchOnce();
      const id = setInterval(() => void fetchOnce(), POLL_MS);
      return () => {
        mountedRef.current = false;
        clearInterval(id);
      };
    }, [fetchOnce])
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  return { snapshot, pointsToday, refresh: fetchOnce };
}
