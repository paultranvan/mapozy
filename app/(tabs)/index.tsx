import { useMemo } from 'react';
import {
  SectionList,
  StyleSheet,
  View,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, useTheme, Appbar } from 'react-native-paper';
import { useTripsList, usePlaces } from '@/queries/useTrips';
import { TripListItem } from '@/ui/TripListItem';
import { dayKey } from '@/lib/time';
import type { Trip } from '@/types';

interface Section {
  title: string;
  data: Trip[];
}

function groupByDay(trips: Trip[]): Section[] {
  const map = new Map<string, Trip[]>();
  for (const t of trips) {
    const k = dayKey(t.startTimeMs);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  const todayKey = dayKey(Date.now());
  const yesterdayKey = dayKey(Date.now() - 86_400_000);
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([k, data]) => ({
      title: k === todayKey ? 'Today' : k === yesterdayKey ? 'Yesterday' : k,
      data,
    }));
}

export default function TripsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const tripsQ = useTripsList(500);
  const placesQ = usePlaces();

  const sections = useMemo(
    () => (tripsQ.data ? groupByDay(tripsQ.data) : []),
    [tripsQ.data]
  );
  const placeById = useMemo(() => {
    const m = new Map<number, (typeof placesQ.data)[number]>();
    if (placesQ.data) for (const p of placesQ.data) m.set(p.id, p);
    return m;
  }, [placesQ.data]);

  if (tripsQ.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[{ flex: 1 }, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ paddingTop: insets.top }}>
        <Appbar.Content title="Mapozy" />
      </Appbar.Header>
      {sections.length === 0 ? (
        <View style={styles.center}>
          <Text variant="bodyLarge">No trips yet</Text>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
          >
            Move around — trips will appear here.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => String(t.id)}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <View
              style={[
                styles.sectionHeader,
                { backgroundColor: theme.colors.background },
              ]}
            >
              <Text variant="titleSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TripListItem
              trip={item}
              startPlace={item.startPlaceId !== null ? placeById.get(item.startPlaceId) : null}
              endPlace={item.endPlaceId !== null ? placeById.get(item.endPlaceId) : null}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={tripsQ.isRefetching}
              onRefresh={() => {
                tripsQ.refetch();
                placesQ.refetch();
              }}
              tintColor={theme.colors.primary}
            />
          }
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: theme.colors.surfaceVariant }} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
});
