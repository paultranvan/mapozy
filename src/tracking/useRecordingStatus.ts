import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { MapozyTracker } from 'mapozy-tracker';
import { useDb } from '../db/DbContext';
import { getSetting, SETTING_KEYS } from '../db/settings';
import { getRecentRawPoints } from '../db/rawPoints';
import {
  deriveRecordingState,
  RECORDING_WINDOW_MS,
  type RecordingStatus,
} from './recording';

const POLL_MS = 10_000;

export interface RecordingHealth {
  status: RecordingStatus;
  refresh: () => Promise<void>;
}

export function useRecordingStatus(): RecordingHealth {
  const db = useDb();
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const mountedRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (!db) return;
    const now = Date.now();
    const [trackerStatus, enabledRaw, recentPoints] = await Promise.all([
      MapozyTracker.getStatus(),
      getSetting(db, SETTING_KEYS.TRACKING_ENABLED),
      getRecentRawPoints(db, now - RECORDING_WINDOW_MS),
    ]);
    const next = deriveRecordingState({
      trackingEnabledSetting: enabledRaw === '1',
      isTracking: !!trackerStatus.isTracking,
      recentPoints,
    });
    if (!mountedRef.current) return;
    setStatus(next);
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

  return { status, refresh: fetchOnce };
}
