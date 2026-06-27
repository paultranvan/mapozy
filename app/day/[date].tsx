import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Stack, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator } from 'react-native-paper';
import { useDayTrips, usePlaces, useTripDaysWithTrips } from '@/queries/useTrips';
import { useUserPlaces } from '@/queries/usePlaces';
import { nearestUserPoi } from '@/lib/poiResolve';
import { DayMap } from '@/ui/DayMap';
import { ScreenErrorFallback } from '@/ui/ScreenErrorFallback';
import { TripListItem } from '@/ui/TripListItem';
import { WeekStrip, type WeekDay } from '@/ui/WeekStrip';
import { ModeBar } from '@/ui/ModeBar';
import { Text } from '@/ui/Text';
import { effectiveMode } from '@/pipeline/effectiveMode';
import { colors, radii, space } from '@/theme/tokens';
import {
  formatDistance,
  formatDuration,
  formatCo2,
  formatTime,
  capitalize,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  MONTHS_SHORT,
} from '@/lib/format';
import {
  dayKey,
  dayKeyToMs,
  shiftDayKey,
  startOfDayMs,
  endOfDayMs,
} from '@/lib/time';
import type { Trip, Place, Mode, DominantMode } from '@/types';

// Stable empty references so memo deps don't change while a query is pending.
const NO_TRIPS: Trip[] = [];
const NO_DAYS = new Set<string>();

const DAY_MS = 86_400_000;

// The Mon→Sun week containing `key`, plus the range covering it.
function weekFor(key: string): { days: WeekDay[]; startMs: number; endMs: number } {
  const base = dayKeyToMs(key);
  const dow = new Date(base).getDay(); // 0 = Sunday
  const mondayMs = base + (dow === 0 ? -6 : 1 - dow) * DAY_MS;
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const ms = mondayMs + i * DAY_MS;
    const d = new Date(ms);
    days.push({ key: dayKey(ms), label: WEEKDAYS_SHORT[d.getDay()]!, dayNum: d.getDate() });
  }
  return { days, startMs: startOfDayMs(mondayMs), endMs: endOfDayMs(mondayMs + 6 * DAY_MS) };
}

function dayLabel(key: string): string {
  if (key === dayKey(Date.now())) return 'Today';
  if (key === dayKey(Date.now() - 86_400_000)) return 'Yesterday';
  const d = new Date(dayKeyToMs(key));
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
    : `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ScreenErrorFallback error={error} retry={retry} screen="day" />;
}

export default function DayScreen() {
  const params = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // The visible day is local state seeded from the route param. Switching days
  // updates this state in place — NO navigation — so React just re-renders the
  // content (map source data + sheet) instead of a screen transition that
  // flashes the whole screen.
  const [date, setDate] = useState(params.date);

  const tripsQ = useDayTrips(date);
  const placesQ = usePlaces();
  const userPlacesQ = useUserPlaces();
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);

  // Draggable bottom panel. The header (handle + day nav) is the drag zone via
  // a gesture-handler Pan that only activates past 8px of vertical movement
  // (activeOffsetY) — so taps on the chevrons still fire, while a drag resizes
  // the panel. The inner ScrollView scrolls independently of the panel.
  const { height: winH } = useWindowDimensions();
  const MIN_H = Math.round(winH * 0.44);
  const MAX_H = Math.round(winH * 0.9);
  const height = useSharedValue(MIN_H);
  const startHeight = useSharedValue(MIN_H);
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .onBegin(() => {
          startHeight.value = height.value;
        })
        .onUpdate((e) => {
          const h = startHeight.value - e.translationY;
          height.value = h < MIN_H ? MIN_H : h > MAX_H ? MAX_H : h;
        })
        .onEnd(() => {
          const snap = height.value > (MIN_H + MAX_H) / 2 ? MAX_H : MIN_H;
          height.value = withSpring(snap, { damping: 22, stiffness: 200 });
        }),
    [MIN_H, MAX_H, height, startHeight]
  );
  const panelStyle = useAnimatedStyle(() => ({ height: height.value }));

  // Drop any highlight when switching day.
  useEffect(() => setSelectedTripId(null), [date]);

  const week = useMemo(() => weekFor(date), [date]);
  const weekDaysQ = useTripDaysWithTrips(week.startMs, week.endMs);
  const daysWithTrips = weekDaysQ.data ?? NO_DAYS;

  const placeById = useMemo(() => {
    const m = new Map<number, Place>();
    if (placesQ.data) for (const p of placesQ.data) m.set(p.id, p);
    return m;
  }, [placesQ.data]);

  const trips: Trip[] = tripsQ.data ?? NO_TRIPS;

  // User POI places that are endpoints of the day's trips → shown as pins.
  const placeMarkers = useMemo(() => {
    const ids = new Set<number>();
    for (const t of trips) {
      if (t.startPlaceId != null) ids.add(t.startPlaceId);
      if (t.endPlaceId != null) ids.add(t.endPlaceId);
    }
    const out: { kind: string; coord: [number, number]; name: string | null }[] = [];
    for (const id of ids) {
      const p = placeById.get(id);
      if (!p) continue;
      const poi = nearestUserPoi(p.latitude, p.longitude, userPlacesQ.data ?? []);
      if (poi) {
        out.push({ kind: poi.category ?? 'other', coord: [p.longitude, p.latitude], name: poi.name });
      }
    }
    return out;
  }, [trips, placeById, userPlacesQ.data]);

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

  // Distance per mode across the day (effectiveMode → respects user edits).
  const modeBreakdown = useMemo(() => {
    const byMode = new Map<Mode, number>();
    for (const t of trips) {
      for (const s of t.sections) {
        const m = effectiveMode(s);
        byMode.set(m, (byMode.get(m) ?? 0) + s.distanceM);
      }
    }
    const total = [...byMode.values()].reduce((a, b) => a + b, 0);
    const rows = [...byMode.entries()]
      .map(([mode, distanceM]) => ({
        mode,
        distanceM,
        pct: total > 0 ? Math.round((100 * distanceM) / total) : 0,
      }))
      .sort((a, b) => b.distanceM - a.distanceM);
    return {
      rows,
      segments: rows.map((r) => ({ mode: r.mode as DominantMode, distanceM: r.distanceM })),
    };
  }, [trips]);

  const goDay = (delta: number) => setDate((d) => shiftDayKey(d, delta));

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={StyleSheet.absoluteFill}>
        {tripsQ.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.inkOnGround} />
          </View>
        ) : (
          <DayMap
            trips={trips}
            selectedTripId={selectedTripId}
            placeMarkers={placeMarkers}
          />
        )}
      </View>

      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        style={({ pressed }) => [
          styles.fab,
          styles.fabLeft,
          { top: insets.top + space[2] },
          pressed && styles.fabPressed,
        ]}
      >
        <MaterialCommunityIcons name="chevron-left" size={26} color={colors.inkOnGround} />
      </Pressable>

      <Animated.View style={[styles.panel, panelStyle]}>
        {/* Whole header is the drag zone (handle + day nav + week strip). The
            Pan gesture only activates past 8px of vertical movement, so taps on
            the chevrons and week days still work. Pinned above the content. */}
        <GestureDetector gesture={dragGesture}>
          <View style={styles.dragHeader}>
            <View style={styles.handle} />
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
          </View>
        </GestureDetector>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.sheet}
          showsVerticalScrollIndicator={false}
        >
          {summary.count === 0 ? (
            <View style={styles.emptyDay}>
              <Text variant="body" soft align="center">
                No trips on this day.
              </Text>
            </View>
          ) : (
            <>
              {/* 1. Trips */}
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

              {/* 2. One-line summary */}
              <View style={styles.summaryRow}>
                <Text variant="title">{formatDistance(summary.distanceM)}</Text>
                <Text variant="meta" soft>
                  {formatDuration(summary.durationS)} · {formatCo2(summary.co2G)}
                </Text>
              </View>

              {/* 3. By mode */}
              {modeBreakdown.rows.length > 0 ? (
                <View style={styles.breakdown}>
                  <Text variant="ribbon" soft style={styles.breakdownLabel}>
                    By mode
                  </Text>
                  <ModeBar segments={modeBreakdown.segments} height={8} radius={4} gap={2} />
                  <View style={styles.legend}>
                    {modeBreakdown.rows.map((r) => (
                      <View key={r.mode} style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: colors.mode[r.mode] ?? colors.mode.mixed },
                          ]}
                        />
                        <Text variant="meta">{capitalize(r.mode)}</Text>
                        <Text variant="meta" soft>
                          {formatDistance(r.distanceM)} · {r.pct}%
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          )}

          {/* 4. Calendar (week strip) */}
          <View style={styles.calendarWrap}>
            <WeekStrip
              days={week.days}
              selectedKey={date}
              daysWithTrips={daysWithTrips}
              onSelect={(key) => setDate(key)}
            />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
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
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: -3 },
    shadowRadius: 8,
    elevation: 12,
  },
  dragHeader: { paddingTop: space[2] },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: space[2],
  },
  scroll: { flex: 1 },
  sheet: { paddingBottom: space[5] },
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
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: space[2],
    marginHorizontal: space[4],
    paddingVertical: space[3],
    marginTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  breakdown: {
    marginHorizontal: space[4],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  calendarWrap: {
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  breakdownLabel: { marginBottom: space[2] },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
    marginTop: space[2],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  list: { paddingTop: space[2] },
  emptyDay: { paddingVertical: space[6], paddingHorizontal: space[4] },
});
