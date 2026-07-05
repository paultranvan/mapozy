import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MapozyTracker } from 'mapozy-tracker';
import type { MotionState } from 'mapozy-tracker';
import { useDb } from '@/db/DbContext';
import { countUnconsumedPoints } from '@/db/rawPoints';
import { usePipelineRunState } from '@/tracking/pipelineStatus';
import { runPipelineIfSafe } from '@/tracking/tracker';
import { derivePipelineBannerState } from './pipelineBannerState';
import { colors, space, radii } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { Text } from './Text';

const POLL_MS = 10_000;

export function PipelineStatusBanner() {
  const { t } = useI18n();
  const db = useDb();
  const qc = useQueryClient();
  const run = usePipelineRunState();
  const [motionState, setMotionState] = useState<MotionState | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [unconsumed, setUnconsumed] = useState(0);

  const fetchOnce = useCallback(async () => {
    if (!db) return;
    const [status, count] = await Promise.all([
      MapozyTracker.getStatus().catch(() => null),
      countUnconsumedPoints(db),
    ]);
    setMotionState(status?.motionState ?? null);
    setIsTracking(status?.isTracking ?? false);
    setUnconsumed(count);
  }, [db]);

  // Refetch on focus and on a light interval so the count/motion stay fresh.
  useFocusEffect(
    useCallback(() => {
      void fetchOnce();
      const id = setInterval(() => void fetchOnce(), POLL_MS);
      return () => clearInterval(id);
    }, [fetchOnce])
  );

  // Refetch whenever a pipeline run completes (lastRunAt changes) so the
  // count and motion state reflect the post-run state immediately.
  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce, run.lastRunAt]);

  const state = derivePipelineBannerState({
    running: run.running,
    enriching: run.enriching,
    isTracking,
    motionState,
    unconsumedCount: unconsumed,
  });

  const onTap = useCallback(() => {
    void runPipelineIfSafe(db, qc);
  }, [db, qc]);

  if (state === 'computing') {
    return (
      <View style={styles.banner}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text variant="label" onGround style={styles.label}>
          {t('pipeline.computing')}
        </Text>
      </View>
    );
  }

  if (state === 'classifying') {
    return (
      <View style={styles.banner}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text variant="label" onGround style={styles.label}>
          {t('pipeline.classifying')}
        </Text>
        {run.draftsPending > 0 ? (
          <Text variant="label" onGround soft style={styles.detail}>
            {t('pipeline.remaining', { count: run.draftsPending })}
          </Text>
        ) : null}
      </View>
    );
  }

  if (state === 'inProgress') {
    return (
      <View style={styles.banner}>
        <MaterialCommunityIcons name="map-marker-path" size={16} color={colors.deep} />
        <Text variant="label" onGround style={styles.label}>
          {t('pipeline.tripInProgress')}
        </Text>
      </View>
    );
  }

  // upToDate — always tappable to recompute.
  return (
    <Pressable
      onPress={onTap}
      hitSlop={6}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.deep} />
      <Text variant="label" onGround style={styles.label}>
        {t('pipeline.upToDate')}
      </Text>
      {unconsumed > 0 ? (
        <Text variant="label" onGround soft style={styles.detail}>
          {t('pipeline.pointsPending', { count: unconsumed })}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      <MaterialCommunityIcons name="refresh" size={16} color={colors.inkOnGroundSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space[4],
    marginTop: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.chip,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    marginLeft: 6,
  },
  detail: {
    marginLeft: 4,
  },
  spacer: {
    flex: 1,
  },
});
