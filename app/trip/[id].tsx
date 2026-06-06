import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Alert, Pressable } from 'react-native';
import type { AlertButton } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator } from 'react-native-paper';
import { useTrip, usePlace } from '@/queries/useTrips';
import { useDb } from '@/db/DbContext';
import { useQueryClient } from '@tanstack/react-query';
import { deleteTrip, getTripBefore, getTripAfter } from '@/db/trips';
import {
  setSectionMode,
  mergeAdjacentSections,
  splitSection,
  splitTrip,
  mergeTrips,
  resetTripToAuto,
} from '@/db/tripEdits';
import { locateSplitPoint } from '@/pipeline/edits/locateSplitPoint';
import { effectiveMode } from '@/pipeline/effectiveMode';
import { makeOverpassDeps } from '@/tracking/overpassDeps';
import { geocodePlaceLazy, fallbackPlaceLabel } from '@/pipeline/geocoding';
import { TripMap } from '@/ui/TripMap';
import { Text } from '@/ui/Text';
import { Timeline } from '@/ui/Timeline';
import { ModePickerSheet } from '@/ui/ModePickerSheet';
import { SplitPickerSheet } from '@/ui/SplitPickerSheet';
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
  const [modePickerSection, setModePickerSection] = useState<Section | null>(null);
  const [splitTarget, setSplitTarget] = useState<SplitTarget | null>(null);

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

  async function onPickMode(mode: Mode) {
    const sec = modePickerSection;
    setModePickerSection(null);
    if (!sec?.id) return;
    await setSectionMode(db, id, sec.id, mode);
    await refresh();
  }

  function openSplit(target: SplitTarget) {
    setSplitTarget(target);
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

  function onSectionPress(section: Section, index: number) {
    const buttons: AlertButton[] = [
      { text: 'Change mode', onPress: () => setModePickerSection(section) },
    ];
    if (sectionVertexCount(section) >= 3) {
      buttons.push({ text: 'Split this leg…', onPress: () => openSplit({ kind: 'leg', section }) });
    }
    if (index > 0) {
      buttons.push({
        text: 'Merge with leg above',
        onPress: async () => {
          await mergeAdjacentSections(db, id, index - 1);
          await refresh();
        },
      });
    }
    if (index < trip.sections.length - 1) {
      buttons.push({
        text: 'Merge with leg below',
        onPress: async () => {
          await mergeAdjacentSections(db, id, index);
          await refresh();
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    const m = effectiveMode(section);
    Alert.alert(`${m.charAt(0).toUpperCase() + m.slice(1)} leg`, undefined, buttons);
  }

  async function onMenu() {
    const prev = await getTripBefore(db, trip.startTimeMs);
    const next = await getTripAfter(db, trip.endTimeMs);
    const buttons: AlertButton[] = [];
    if (trip.sections.some((s: Section) => sectionVertexCount(s) >= 3)) {
      buttons.push({ text: 'Split trip…', onPress: () => openSplit({ kind: 'trip' }) });
    }
    if (prev?.id != null) {
      buttons.push({
        text: 'Merge with previous trip',
        onPress: async () => {
          const prevId = prev.id!;
          await mergeTrips(db, prevId, id);
          await refresh();
          router.replace(`/trip/${prevId}`);
        },
      });
    }
    if (next?.id != null) {
      buttons.push({
        text: 'Merge with next trip',
        onPress: async () => {
          await mergeTrips(db, id, next.id!);
          await refresh();
        },
      });
    }
    if (trip.edited) {
      buttons.push({
        text: 'Reset to auto',
        onPress: async () => {
          await resetTripToAuto(db, id, Date.now(), makeOverpassDeps(db));
          await refresh();
          router.back();
        },
      });
    }
    buttons.push({
      text: 'Delete trip',
      style: 'destructive',
      onPress: async () => {
        await deleteTrip(db, id);
        await refresh();
        router.back();
      },
    });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Trip', undefined, buttons);
  }

  const startLabel =
    startPlaceQ.data?.label === 'home'
      ? 'Home'
      : startPlaceQ.data?.label === 'work'
      ? 'Work'
      : startPlaceQ.data?.displayName ??
        (startPlaceQ.data
          ? fallbackPlaceLabel(startPlaceQ.data.latitude, startPlaceQ.data.longitude)
          : 'Start');
  const endLabel =
    endPlaceQ.data?.label === 'home'
      ? 'Home'
      : endPlaceQ.data?.label === 'work'
      ? 'Work'
      : endPlaceQ.data?.displayName ??
        (endPlaceQ.data
          ? fallbackPlaceLabel(endPlaceQ.data.latitude, endPlaceQ.data.longitude)
          : 'End');

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
          <Text variant="ribbon" soft style={styles.ribbon}>
            {ribbon}
            {trip.edited ? '  ·  EDITED' : ''}
          </Text>
          <Text variant="display" style={styles.headline}>
            {startLabel} to {endLabel}
          </Text>
          <Text variant="display" soft style={styles.subheadline}>
            in {headlineDuration}, {headlineDistance}
          </Text>

          <View style={styles.timelineWrap}>
            <Timeline
              startLabel={startLabel}
              endLabel={endLabel}
              startTimeMs={trip.startTimeMs}
              endTimeMs={trip.endTimeMs}
              sections={trip.sections}
              breaks={trip.breaks}
              onSectionPress={onSectionPress}
            />
          </View>

          <View style={styles.footer}>
            <Text variant="meta" soft>
              CO₂ {formatCo2(trip.co2G)}
            </Text>
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
      <ModePickerSheet
        visible={modePickerSection !== null}
        onPick={onPickMode}
        onClose={() => setModePickerSection(null)}
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
  ribbon: {
    marginBottom: space[1],
  },
  headline: {
    marginBottom: 0,
  },
  subheadline: {
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
