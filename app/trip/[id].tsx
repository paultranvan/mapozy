import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator } from 'react-native-paper';
import { useTrip, usePlace } from '@/queries/useTrips';
import { useDb } from '@/db/DbContext';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteTrip,
  getTripBefore,
  getTripAfter,
  getTripContainingTime,
} from '@/db/trips';
import {
  setSectionMode,
  mergeAdjacentSections,
  splitSection,
  splitTrip,
  mergeTrips,
  resetTripToAuto,
} from '@/db/tripEdits';
import { locateSplitPoint } from '@/pipeline/edits/locateSplitPoint';
import { makeOverpassDeps } from '@/tracking/overpassDeps';
import { geocodePlaceLazy } from '@/pipeline/geocoding';
import { placeLabels } from '@/lib/placeLabel';
import { useUserPlaces } from '@/queries/usePlaces';
import { nearestUserPoi } from '@/lib/poiResolve';
import { TripMap } from '@/ui/TripMap';
import { Text } from '@/ui/Text';
import { Timeline } from '@/ui/Timeline';
import { SplitPickerSheet } from '@/ui/SplitPickerSheet';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { EditedPill } from '@/ui/EditedPill';
import { colors, radii, space } from '@/theme/tokens';
import type { Section, Mode } from '@/types';
import {
  formatDistance,
  formatDuration,
  formatCo2,
  formatTime,
} from '@/lib/format';

type SplitTarget = { kind: 'leg'; section: Section } | { kind: 'trip' };

const WEEKDAY_UPPER = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

export default function TripDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const db = useDb();
  const qc = useQueryClient();
  const tripQ = useTrip(id);
  const startPlaceQ = usePlace(tripQ.data?.startPlaceId ?? null);
  const endPlaceQ = usePlace(tripQ.data?.endPlaceId ?? null);
  const userPlaces = useUserPlaces();
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!tripQ.data) return;
    (async () => {
      if (tripQ.data!.startPlaceId !== null) {
        await geocodePlaceLazy(db, tripQ.data!.startPlaceId);
      }
      if (tripQ.data!.endPlaceId !== null) {
        await geocodePlaceLazy(db, tripQ.data!.endPlaceId);
      }
      await qc.invalidateQueries({ queryKey: ['place'] });
      await qc.invalidateQueries({ queryKey: ['places'] });
    })();
  }, [db, qc, tripQ.data]);

  const snapPoints = useMemo(() => ['38%', '88%'], []);
  const [splitTarget, setSplitTarget] = useState<SplitTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuActions, setMenuActions] = useState<SheetAction[]>([]);

  if (tripQ.isLoading || !tripQ.data) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <FloatingIconButton
          icon="chevron-left"
          onPress={() => router.back()}
          style={[styles.fabLeft, { top: insets.top + space[2] }]}
          size={26}
        />
        <View style={styles.center}>
          <ActivityIndicator color={colors.inkOnGround} />
        </View>
      </View>
    );
  }

  const trip = tripQ.data;

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['trip'] });
    await qc.invalidateQueries({ queryKey: ['trips'] });
    await qc.invalidateQueries({ queryKey: ['stats'] });
  }

  function sectionVertexCount(s: Section): number {
    try {
      return (JSON.parse(s.geojson).coordinates as unknown[]).length;
    } catch {
      return 0;
    }
  }

  async function onChangeMode(section: Section, mode: Mode) {
    if (!section.id) return;
    await setSectionMode(db, id, section.id, mode);
    await refresh();
  }

  function onSplitLeg(section: Section) {
    setSplitTarget({ kind: 'leg', section });
  }

  async function onMergeUp(index: number) {
    await mergeAdjacentSections(db, id, index - 1);
    await refresh();
  }

  async function onMergeDown(index: number) {
    await mergeAdjacentSections(db, id, index);
    await refresh();
  }

  async function onSplitConfirm(point: [number, number]) {
    const target = splitTarget;
    setSplitTarget(null);
    if (!target) return;
    if (target.kind === 'leg') {
      if (!target.section.id) return;
      const loc = locateSplitPoint([target.section], point);
      if (loc) await splitSection(db, id, loc.sectionId, loc.vertexIndex);
    } else {
      const loc = locateSplitPoint(trip.sections, point);
      if (loc) await splitTrip(db, id, loc.sectionId, loc.vertexIndex);
    }
    await refresh();
  }

  async function onMenu() {
    const prev = await getTripBefore(db, trip.startTimeMs);
    const next = await getTripAfter(db, trip.endTimeMs);
    const acts: SheetAction[] = [];
    if (trip.sections.some((s: Section) => sectionVertexCount(s) >= 3)) {
      acts.push({
        label: 'Split this trip',
        icon: 'call-split',
        onPress: () => setSplitTarget({ kind: 'trip' }),
      });
    }
    if (prev?.id != null) {
      acts.push({
        // The trip list is ordered newest-first, so the chronologically
        // *previous* (earlier) trip sits visually *below* this one — hence the
        // down arrow. (Was arrow-up, which read backwards to testers.)
        label: 'Merge with previous trip',
        icon: 'arrow-down',
        onPress: async () => {
          const prevId = prev.id!;
          await mergeTrips(db, prevId, id);
          await refresh();
          router.replace(`/trip/${prevId}`);
        },
      });
    }
    if (next?.id != null) {
      acts.push({
        // Newest-first list: the chronologically *next* (later) trip sits
        // visually *above* this one — hence the up arrow.
        label: 'Merge with next trip',
        icon: 'arrow-up',
        onPress: async () => {
          await mergeTrips(db, id, next.id!);
          await refresh();
        },
      });
    }
    if (trip.edited) {
      acts.push({
        label: 'Reset to auto-detected',
        icon: 'backup-restore',
        onPress: async () => {
          const origStartMs = trip.startTimeMs;
          await resetTripToAuto(db, id, Date.now(), makeOverpassDeps(db));
          await refresh();
          // Reset deletes & rebuilds the trip with a fresh id, so the current
          // /trip/{id} route is now stale. Re-locate the rebuilt trip covering
          // the original start and stay on it instead of bouncing to the list.
          const rebuilt =
            (await getTripContainingTime(db, origStartMs)) ??
            (await getTripAfter(db, origStartMs));
          if (rebuilt?.id != null) {
            router.replace(`/trip/${rebuilt.id}`);
          } else {
            router.back();
          }
        },
      });
    }
    acts.push({
      label: 'Delete trip',
      icon: 'trash-can-outline',
      destructive: true,
      onPress: async () => {
        await deleteTrip(db, id);
        await refresh();
        router.back();
      },
    });
    setMenuActions(acts);
    setMenuOpen(true);
  }

  const startPoi = startPlaceQ.data
    ? nearestUserPoi(startPlaceQ.data.latitude, startPlaceQ.data.longitude, userPlaces.data ?? [])
    : null;
  const endPoi = endPlaceQ.data
    ? nearestUserPoi(endPlaceQ.data.latitude, endPlaceQ.data.longitude, userPlaces.data ?? [])
    : null;
  const startLabels = placeLabels(startPlaceQ.data, 'Start', startPoi);
  const endLabels = placeLabels(endPlaceQ.data, 'End', endPoi);

  const start = new Date(trip.startTimeMs);
  const ribbon = `${WEEKDAY_UPPER[start.getDay()]} · ${formatTime(
    trip.startTimeMs
  )} → ${formatTime(trip.endTimeMs)}`;

  const headlineDistance = formatDistance(trip.distanceM);
  const headlineDuration = formatDuration(trip.durationS);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={StyleSheet.absoluteFill}>
        <TripMap trip={trip} />
      </View>
      <FloatingIconButton
        icon="chevron-left"
        onPress={() => router.back()}
        style={[styles.fabLeft, { top: insets.top + space[2] }]}
        size={26}
      />
      <FloatingIconButton
        icon="dots-horizontal"
        onPress={() => {
          void onMenu();
        }}
        style={[styles.fabRight, { top: insets.top + space[2] }]}
        size={22}
      />
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
      >
        <BottomSheetScrollView contentContainerStyle={styles.sheet}>
          <View style={styles.ribbonRow}>
            <Text variant="ribbon" soft>
              {ribbon}
            </Text>
            {trip.edited ? <EditedPill /> : null}
          </View>
          <Text variant="label" soft numberOfLines={1} style={styles.fromCaption}>
            from {startLabels.full}
          </Text>
          <Text variant="display" numberOfLines={1} style={styles.destination}>
            {endLabels.short}
          </Text>
          <Text variant="meta" soft style={styles.stats}>
            {headlineDuration} · {headlineDistance}
          </Text>

          <View style={styles.timelineWrap}>
            <Timeline
              startLabel={startLabels.full}
              endLabel={endLabels.full}
              startTimeMs={trip.startTimeMs}
              endTimeMs={trip.endTimeMs}
              sections={trip.sections}
              breaks={trip.breaks}
              editable
              onChangeMode={onChangeMode}
              onSplitLeg={onSplitLeg}
              onMergeUp={onMergeUp}
              onMergeDown={onMergeDown}
            />
          </View>

          <View style={styles.footer}>
            <Text variant="meta" soft>
              {formatCo2(trip.co2G)}
            </Text>
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
      <ActionSheet
        visible={menuOpen}
        title="Edit trip"
        actions={menuActions}
        onClose={() => setMenuOpen(false)}
      />
      <SplitPickerSheet
        visible={splitTarget !== null}
        title={
          splitTarget?.kind === 'trip'
            ? 'Where did this trip split?'
            : 'Where does this leg change?'
        }
        geojsons={
          splitTarget?.kind === 'leg'
            ? [splitTarget.section.geojson]
            : trip.sections.map((s: Section) => s.geojson)
        }
        onConfirm={onSplitConfirm}
        onClose={() => setSplitTarget(null)}
      />
    </View>
  );
}

function FloatingIconButton({
  icon,
  onPress,
  style,
  size,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  style: object | object[];
  size: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.fab,
        style,
        pressed && styles.fabPressed,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={size} color={colors.inkOnGround} />
    </Pressable>
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
  },
  fab: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    // Pop above the map without competing with the bottom sheet.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 3,
  },
  fabPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  fabLeft: {
    left: space[3],
  },
  fabRight: {
    right: space[3],
  },
  sheetBg: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  handle: {
    backgroundColor: colors.divider,
    width: 36,
    height: 4,
  },
  sheet: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[6],
  },
  ribbonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginBottom: space[1],
  },
  fromCaption: {
    marginBottom: space[1],
  },
  destination: {
    marginBottom: space[1],
  },
  stats: {
    marginBottom: space[3],
  },
  timelineWrap: {
    marginTop: space[2],
  },
  footer: {
    marginTop: space[4],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
});
