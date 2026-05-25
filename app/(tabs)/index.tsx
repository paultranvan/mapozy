import { useMemo } from 'react';
import {
  SectionList,
  StyleSheet,
  View,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTripsList, usePlaces } from '@/queries/useTrips';
import { TripListItem } from '@/ui/TripListItem';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { colors, space } from '@/theme/tokens';
import { dayKey } from '@/lib/time';
import type { Trip } from '@/types';

interface Section {
  title: string;
  data: Trip[];
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayHeader(k: string): string {
  const todayKey = dayKey(Date.now());
  const yesterdayKey = dayKey(Date.now() - 86_400_000);
  if (k === todayKey) return 'Today';
  if (k === yesterdayKey) return 'Yesterday';
  const parts = k.split('-').map((n) => Number(n));
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const weekday = WEEKDAY[date.getDay()];
  return sameYear
    ? `${weekday}, ${d} ${MONTHS[m - 1]}`
    : `${weekday}, ${d} ${MONTHS[m - 1]} ${y}`;
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
    .map(([k, data]) => ({ title: dayHeader(k), data }));
}

export default function TripsScreen() {
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
      <View style={styles.root}>
        <TopBar title="Mapozy" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.inkOnGround} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TopBar title="Mapozy" />
      {sections.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons
            name="compass-outline"
            size={56}
            color={colors.inkOnGroundSoft}
          />
          <Text variant="display" onGround align="center" style={styles.emptyTitle}>
            No trips yet
          </Text>
          <Text variant="body" onGround soft align="center">
            Move around — trips will appear here.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => String(t.id)}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section }) => (
            <Text variant="dayHeader" onGround style={styles.sectionHeader}>
              {section.title}
            </Text>
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
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
  },
});
