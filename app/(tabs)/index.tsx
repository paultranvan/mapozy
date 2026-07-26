import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SectionList,
  StyleSheet,
  View,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTripsList, usePlaces } from '@/queries/useTrips';
import { useDb } from '@/db/DbContext';
import { geocodePlaceLazy } from '@/pipeline/geocoding';
import { TripListItem } from '@/ui/TripListItem';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { RecordingPill } from '@/ui/RecordingPill';
import { useRecordingStatus } from '@/tracking/useRecordingStatus';
import { runDraftEnrichment } from '@/tracking/refreshDrafts';
import { runPipelineIfSafe } from '@/tracking/tracker';
import { PipelineStatusBanner } from '@/ui/PipelineStatusBanner';
import { TripSelectionBar } from '@/ui/TripSelectionBar';
import { deleteTrips } from '@/db/trips';
import { planRecompute, recomputeForTrips } from '@/pipeline/recomputeRange';
import { makeOverpassDeps } from '@/tracking/overpassDeps';
import { useTiimeConnection, useTiimeCandidates } from '@/queries/useTiime';
import { colors, space, radii } from '@/theme/tokens';
import { dayKey, dayKeyToMs } from '@/lib/time';
import { formatDayHeader } from '@/lib/format';
import { t as translate, useI18n } from '@/i18n';
import type { Trip, Place } from '@/types';

interface Section {
  title: string;
  dateKey: string;
  data: Trip[];
}

function dayHeader(k: string): string {
  const todayKey = dayKey(Date.now());
  const yesterdayKey = dayKey(Date.now() - 86_400_000);
  if (k === todayKey) return translate('trips.today');
  if (k === yesterdayKey) return translate('trips.yesterday');
  return formatDayHeader(dayKeyToMs(k));
}

function groupByDay(trips: Trip[]): Section[] {
  const map = new Map<string, Trip[]>();
  for (const t of trips) {
    const k = dayKey(t.startTimeMs);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([k, data]) => ({ title: dayHeader(k), dateKey: k, data }));
}

export default function TripsScreen() {
  const { t, locale } = useI18n();
  const db = useDb();
  const qc = useQueryClient();
  const router = useRouter();
  const tripsQ = useTripsList(500);
  const placesQ = usePlaces();
  const recording = useRecordingStatus();
  const tiimeConnection = useTiimeConnection();
  const tiimeCandidatesQ = useTiimeCandidates();

  useFocusEffect(
    useCallback(() => {
      void runPipelineIfSafe(db, qc);
    }, [db, qc])
  );

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const enterSelect = useCallback((id: number) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  }, []);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const refreshAfterMutation = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['trips'] });
    await qc.invalidateQueries({ queryKey: ['stats'] });
    await qc.invalidateQueries({ queryKey: ['places'] });
  }, [qc]);

  const onDelete = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    Alert.alert(
      t('trips.deleteTitle', { count: ids.length }),
      t('trips.deleteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteTrips(db, ids);
            await refreshAfterMutation();
            exitSelect();
          },
        },
      ]
    );
  }, [selected, db, refreshAfterMutation, exitSelect, t]);

  const onRecompute = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const plan = await planRecompute(db, ids);
    if (plan.missingRawTripIds.length > 0) {
      Alert.alert(
        t('trips.cantRecomputeTitle'),
        t('trips.cantRecomputeBody', { count: plan.missingRawTripIds.length })
      );
      return;
    }
    let body = t('trips.recomputeBody');
    if (plan.extraCount > 0) {
      body += ' ' + t('trips.recomputeExtra', { count: plan.extraCount });
    }
    Alert.alert(t('trips.recomputeTitle', { count: ids.length }), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trips.recompute'),
        onPress: async () => {
          try {
            await recomputeForTrips(db, plan, Date.now(), makeOverpassDeps(db));
            await refreshAfterMutation();
            // Rebuilt trips are pending drafts — classify them in background.
            void runDraftEnrichment(db, qc).catch(() => {});
            exitSelect();
          } catch (e) {
            // Recompute is not atomic; refresh so any partial rebuild shows,
            // but stay in select mode so the user can retry.
            await refreshAfterMutation();
            Alert.alert(t('trips.recomputeFailed'), String(e));
          }
        },
      },
    ]);
  }, [selected, db, qc, refreshAfterMutation, exitSelect, t]);

  const onRefresh = useCallback(async () => {
    await runPipelineIfSafe(db, qc);
    // Single-flight: if a background pass is already classifying drafts this
    // joins it instead of double-hitting Overpass with a concurrent pass.
    const res = await runDraftEnrichment(db, qc).catch(() => ({ enriched: 0, rateLimited: false }));
    if (res.rateLimited) {
      Alert.alert(t('trips.transitBusyTitle'), t('trips.transitBusyBody'));
    }
    await Promise.all([tripsQ.refetch(), placesQ.refetch(), recording.refresh()]);
    if (res.enriched > 0) {
      await qc.invalidateQueries({ queryKey: ['stats'] });
    }
  }, [db, qc, tripsQ, placesQ, recording, t]);

  const sections = useMemo(
    () => (tripsQ.data ? groupByDay(tripsQ.data) : []),
    // `locale` so day headers re-render in the new language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tripsQ.data, locale]
  );
  const placeById = useMemo(() => {
    const m = new Map<number, (typeof placesQ.data)[number]>();
    if (placesQ.data) for (const p of placesQ.data) m.set(p.id, p);
    return m;
  }, [placesQ.data]);

  useEffect(() => {
    if (!placesQ.data) return;
    const pending = placesQ.data
      .filter((p: Place) => !p.displayName)
      .map((p: Place) => p.id);
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const id of pending) {
        if (cancelled) return;
        const name = await geocodePlaceLazy(db, id);
        if (cancelled) return;
        if (name) {
          await qc.invalidateQueries({ queryKey: ['places'] });
          await qc.invalidateQueries({ queryKey: ['place', id] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, qc, placesQ.data]);

  const tiimeCandidateCount = tiimeCandidatesQ.data?.length ?? 0;
  const showTiimeBanner = tiimeConnection.connected && tiimeCandidateCount > 0;

  const topBar = selectMode ? (
    <TripSelectionBar
      count={selected.size}
      onCancel={exitSelect}
      onDelete={onDelete}
      onRecompute={onRecompute}
    />
  ) : (
    <TopBar
      title="Mapozy"
      rightNode={<RecordingPill status={recording.status} />}
    />
  );

  if (tripsQ.isLoading) {
    return (
      <View style={styles.root}>
        {topBar}
        <View style={styles.center}>
          <ActivityIndicator color={colors.inkOnGround} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {topBar}
      <PipelineStatusBanner />
      {showTiimeBanner ? (
        <Pressable
          onPress={() => router.push('/tiime')}
          style={({ pressed }) => [styles.tiimeBanner, pressed && styles.tiimeBannerPressed]}
        >
          <MaterialCommunityIcons name="briefcase-upload-outline" size={16} color={colors.accent} />
          <Text variant="label" color={colors.accent} style={styles.tiimeBannerLabel}>
            {t('trips.tiimePendingBanner', { count: tiimeCandidateCount })}
          </Text>
          <View style={styles.tiimeBannerSpacer} />
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.accent} />
        </Pressable>
      ) : null}
      {sections.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons
            name="compass-outline"
            size={56}
            color={colors.inkOnGroundSoft}
          />
          <Text variant="display" onGround align="center" style={styles.emptyTitle}>
            {t('trips.emptyTitle')}
          </Text>
          <Text variant="body" onGround soft align="center">
            {t('trips.emptyBody')}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => String(t.id)}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section }) => (
            <Pressable
              onPress={() => router.push(`/day/${section.dateKey}`)}
              style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}
            >
              <Text variant="dayHeader" onGround>
                {section.title}
              </Text>
              <MaterialCommunityIcons
                name="map-outline"
                size={18}
                color={colors.inkOnGroundSoft}
              />
            </Pressable>
          )}
          renderItem={({ item }) => (
            <TripListItem
              trip={item}
              startPlace={item.startPlaceId !== null ? placeById.get(item.startPlaceId) : null}
              endPlace={item.endPlaceId !== null ? placeById.get(item.endPlaceId) : null}
              selectMode={selectMode}
              selected={selected.has(item.id!)}
              onLongPress={enterSelect}
              onToggle={toggle}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={tripsQ.isRefetching}
              onRefresh={onRefresh}
              tintColor={colors.inkOnGround}
              colors={[colors.inkOnGround]}
            />
          }
          SectionSeparatorComponent={() => <View style={{ height: space[1] }} />}
          ItemSeparatorComponent={() => <View style={{ height: space[1] }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[5],
  },
  emptyTitle: {
    marginTop: space[2],
  },
  list: {
    paddingBottom: space[5],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
  },
  sectionHeaderPressed: {
    opacity: 0.6,
  },
  tiimeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space[4],
    marginTop: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    backgroundColor: colors.accentSoft,
    borderRadius: radii.chip,
  },
  tiimeBannerPressed: {
    opacity: 0.7,
  },
  tiimeBannerLabel: {
    marginLeft: 6,
  },
  tiimeBannerSpacer: {
    flex: 1,
  },
});
