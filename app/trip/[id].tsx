import { useEffect, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text, useTheme, ActivityIndicator, IconButton } from 'react-native-paper';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useRef } from 'react';
import { useTrip, usePlace } from '@/queries/useTrips';
import { useDb } from '@/db/DbContext';
import { useQueryClient } from '@tanstack/react-query';
import { deleteTrip } from '@/db/trips';
import { geocodePlaceLazy, fallbackPlaceLabel } from '@/pipeline/geocoding';
import { TripMap } from '@/ui/TripMap';
import { ModeIcon } from '@/ui/ModeIcon';
import {
  formatDistance,
  formatDuration,
  formatCo2,
  formatTime,
  formatSpeed,
} from '@/lib/format';
import { MODE_COLORS } from '@/theme/colors';
import { Alert } from 'react-native';

export default function TripDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const theme = useTheme();
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

  const snapPoints = useMemo(() => ['28%', '78%'], []);

  async function onDelete() {
    Alert.alert('Delete this trip?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
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
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
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

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: 'Trip',
          headerRight: () => (
            <IconButton icon="delete" onPress={onDelete} />
          ),
        }}
      />
      <View style={StyleSheet.absoluteFill}>
        <TripMap trip={trip} />
      </View>
      <BottomSheet ref={sheetRef} index={0} snapPoints={snapPoints}>
        <BottomSheetScrollView contentContainerStyle={styles.sheet}>
          <View style={styles.header}>
            <ModeIcon mode={trip.dominantMode} size={28} />
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" numberOfLines={1}>
                {startLabel} → {endLabel}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {formatTime(trip.startTimeMs)} · {formatDuration(trip.durationS)} ·{' '}
                {formatDistance(trip.distanceM)}
              </Text>
            </View>
          </View>
          <Text variant="bodyMedium" style={styles.co2}>
            {formatCo2(trip.co2G)}
          </Text>

          <View style={styles.timeline}>
            <Pressable style={styles.timelineRow}>
              <View style={[styles.dot, { backgroundColor: '#2A9D8F' }]} />
              <View style={{ flex: 1 }}>
                <Text variant="labelMedium" style={styles.timelineTime}>
                  {formatTime(trip.startTimeMs)}
                </Text>
                <Text variant="bodyLarge">{startLabel}</Text>
              </View>
            </Pressable>
            {trip.sections.map((s: typeof trip.sections[number]) => (
              <View key={s.ordering}>
                <View style={styles.sectionLine}>
                  <View
                    style={[
                      styles.verticalLine,
                      { backgroundColor: MODE_COLORS[s.mode as keyof typeof MODE_COLORS] ?? '#888' },
                    ]}
                  />
                  <View style={{ flex: 1, gap: 2, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ModeIcon mode={s.mode} size={18} />
                      <Text variant="bodyMedium" style={{ textTransform: 'capitalize' }}>
                        {s.mode}
                      </Text>
                    </View>
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      {formatDuration(s.durationS)} · {formatDistance(s.distanceM)} · avg{' '}
                      {formatSpeed(s.avgSpeedMps)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
            <Pressable style={styles.timelineRow}>
              <View style={[styles.dot, { backgroundColor: '#E76F51' }]} />
              <View style={{ flex: 1 }}>
                <Text variant="labelMedium" style={styles.timelineTime}>
                  {formatTime(trip.endTimeMs)}
                </Text>
                <Text variant="bodyLarge">{endLabel}</Text>
              </View>
            </Pressable>
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheet: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  co2: { color: '#666' },
  timeline: { marginTop: 8, gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 4 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: 'white' },
  timelineTime: { color: '#666' },
  sectionLine: {
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 5,
  },
  verticalLine: {
    width: 4,
    marginLeft: 1,
    borderRadius: 2,
  },
});
