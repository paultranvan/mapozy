import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator } from 'react-native-paper';
import { useDayTrips, usePlaces } from '@/queries/useTrips';
import { DayMap } from '@/ui/DayMap';
import { TripListItem } from '@/ui/TripListItem';
import { Text } from '@/ui/Text';
import { colors, radii, space } from '@/theme/tokens';
import { formatDistance, formatDuration, formatCo2, formatTime } from '@/lib/format';
import { dayKey, dayKeyToMs, shiftDayKey } from '@/lib/time';
import type { Trip, Place } from '@/types';

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(key: string): string {
  if (key === dayKey(Date.now())) return 'Today';
  if (key === dayKey(Date.now() - 86_400_000)) return 'Yesterday';
  const d = new Date(dayKeyToMs(key));
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`
    : `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function DayScreen() {
  const params = useLocalSearchParams<{ date: string }>();
  const date = params.date;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const tripsQ = useDayTrips(date);
  const placesQ = usePlaces();
  const snapPoints = useMemo(() => ['42%', '88%'], []);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);

  // Drop any highlight when navigating to another day.
  useEffect(() => setSelectedTripId(null), [date]);

  const placeById = useMemo(() => {
    const m = new Map<number, Place>();
    if (placesQ.data) for (const p of placesQ.data) m.set(p.id, p);
    return m;
  }, [placesQ.data]);

  const trips: Trip[] = tripsQ.data ?? [];
  const summary = useMemo(() => {
    let distanceM = 0, durationS = 0, co2G = 0;
    let firstMs = Infinity, lastMs = -Infinity;
    for (const t of trips) {
      distanceM += t.distanceM;
      durationS += t.durationS;
      co2G += t.co2G;
      if (t.startTimeMs < firstMs) firstMs = t.startTimeMs;
      if (t.endTimeMs > lastMs) lastMs = t.endTimeMs;
    }
    return { distanceM, durationS, co2G, count: trips.length, firstMs, lastMs };
  }, [trips]);

  const goDay = (delta: number) => router.replace(`/day/${shiftDayKey(date, delta)}`);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={StyleSheet.absoluteFill}>
        {tripsQ.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.inkOnGround} />
          </View>
        ) : (
          <DayMap trips={trips} selectedTripId={selectedTripId} />
        )}
      </View>

      <FloatingIconButton
        icon="chevron-left"
        onPress={() => router.back()}
        style={[styles.fabLeft, { top: insets.top + space[2] }]}
        size={26}
      />

      <BottomSheet
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
      >
        <BottomSheetScrollView contentContainerStyle={styles.sheet}>
          <View style={styles.dayNav}>
            <Pressable onPress={() => goDay(-1)} hitSlop={10} style={styles.navBtn}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={colors.ink} />
            </Pressable>
            <View style={styles.dayTitleWrap}>
              <Text variant="display" numberOfLines={1}>
                {dayLabel(date)}
              </Text>
              {summary.count > 0 ? (
                <Text variant="ribbon" soft>
                  {formatTime(summary.firstMs)} – {formatTime(summary.lastMs)}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => goDay(1)} hitSlop={10} style={styles.navBtn}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.ink} />
            </Pressable>
          </View>

          {summary.count === 0 ? (
            <View style={styles.emptyDay}>
              <Text variant="body" soft align="center">
                No trips on this day.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.summary}>
                <Text variant="display" style={styles.summaryBig}>
                  {formatDistance(summary.distanceM)}
                </Text>
                <Text variant="meta" soft style={styles.summaryMeta}>
                  {formatDuration(summary.durationS)} · {summary.count} trip
                  {summary.count > 1 ? 's' : ''} · {formatCo2(summary.co2G)}
                </Text>
              </View>

              {selectedTripId != null ? (
                <Pressable
                  onPress={() => setSelectedTripId(null)}
                  style={styles.showAll}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons name="close" size={15} color={colors.accent} />
                  <Text variant="meta" style={styles.showAllText}>
                    Show all trips
                  </Text>
                </Pressable>
              ) : null}

              <View style={styles.list}>
                {trips.map((t, i) => (
                  <TripListItem
                    key={t.id}
                    trip={t}
                    index={i + 1}
                    selected={selectedTripId === t.id}
                    onPress={() =>
                      setSelectedTripId((prev) => (prev === t.id ? null : t.id ?? null))
                    }
                    onOpen={() => router.push(`/trip/${t.id}`)}
                    startPlace={t.startPlaceId !== null ? placeById.get(t.startPlaceId) : null}
                    endPlace={t.endPlaceId !== null ? placeById.get(t.endPlaceId) : null}
                  />
                ))}
              </View>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
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
      style={({ pressed }) => [styles.fab, style, pressed && styles.fabPressed]}
    >
      <MaterialCommunityIcons name={icon} size={size} color={colors.inkOnGround} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 3,
  },
  fabPressed: { backgroundColor: colors.surfaceMuted },
  fabLeft: { left: space[3] },
  sheetBg: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  handle: { backgroundColor: colors.divider, width: 36, height: 4 },
  sheet: { paddingBottom: space[6] },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[3],
    marginBottom: space[2],
  },
  navBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTitleWrap: { flex: 1, alignItems: 'center' },
  summary: {
    paddingHorizontal: space[4],
    paddingBottom: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  summaryBig: {},
  summaryMeta: { marginTop: space[1] },
  list: { paddingTop: space[2] },
  showAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    alignSelf: 'center',
    paddingVertical: space[2],
  },
  showAllText: { color: colors.accent },
  emptyDay: { paddingVertical: space[6], paddingHorizontal: space[4] },
});
