import { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { ActivityIndicator } from 'react-native-paper';
import { useTrip, usePlace } from '@/queries/useTrips';
import { useDb } from '@/db/DbContext';
import { useQueryClient } from '@tanstack/react-query';
import { deleteTrip } from '@/db/trips';
import { geocodePlaceLazy, fallbackPlaceLabel } from '@/pipeline/geocoding';
import { TripMap } from '@/ui/TripMap';
import { Text } from '@/ui/Text';
import { Timeline } from '@/ui/Timeline';
import { TopBar } from '@/ui/TopBar';
import { colors, radii, space } from '@/theme/tokens';
import {
  formatDistance,
  formatDuration,
  formatCo2,
  formatTime,
} from '@/lib/format';

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
    })();
  }, [db, qc, tripQ.data]);

  const snapPoints = useMemo(() => ['38%', '88%'], []);

  function onMenu() {
    Alert.alert('Trip', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete trip',
        style: 'destructive',
        onPress: async () => {
          await deleteTrip(db, id);
          await qc.invalidateQueries({ queryKey: ['trips'] });
          await qc.invalidateQueries({ queryKey: ['stats'] });
          router.back();
        },
      },
    ]);
  }

  if (tripQ.isLoading || !tripQ.data) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <TopBar title="Trip" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.inkOnGround} />
        </View>
      </View>
    );
  }

  const trip = tripQ.data;

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
      <TopBar
        title={WEEKDAY_UPPER[start.getDay()]!.charAt(0) +
          WEEKDAY_UPPER[start.getDay()]!.slice(1).toLowerCase()}
        onBack={() => router.back()}
        right={{ icon: 'dots-horizontal', onPress: onMenu }}
      />
      <View style={StyleSheet.absoluteFill}>
        <TripMap trip={trip} />
      </View>
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
            />
          </View>

          <View style={styles.footer}>
            <Text variant="meta" soft>
              CO₂ {formatCo2(trip.co2G)}
            </Text>
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
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
  },
  sheetBg: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  handle: {
    backgroundColor: '#D7DBE0',
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
