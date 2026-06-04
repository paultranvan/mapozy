import { View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Card } from './Card';
import { ModeChip } from './ModeChip';
import { ModeBar } from './ModeBar';
import { colors, space } from '@/theme/tokens';
import { formatDistance, formatDuration, formatTime } from '@/lib/format';
import type { Trip, Place, DominantMode } from '@/types';

interface Props {
  trip: Trip;
  startPlace: Place | null | undefined;
  endPlace: Place | null | undefined;
}

function placeLabel(p: Place | null | undefined): string {
  if (!p) return '?';
  if (p.label === 'home') return 'Home';
  if (p.label === 'work') return 'Work';
  if (p.displayName) return p.displayName;
  return `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`;
}

function summarizeModes(trip: Trip): string {
  const modes = Array.from(new Set(trip.sections.map((s) => s.mode)));
  return modes.join(' · ');
}

function modeBarSegments(trip: Trip) {
  if (trip.sections.length < 2) return null;
  return trip.sections.map((s) => ({
    mode: s.mode as DominantMode,
    distanceM: s.distanceM,
  }));
}

export function TripListItem({ trip, startPlace, endPlace }: Props) {
  const router = useRouter();
  const distance = formatDistance(trip.distanceM);
  const [distValue, distUnit] = distance.split(' ');
  const modeSummary = summarizeModes(trip);
  const segments = modeBarSegments(trip);

  return (
    <Pressable onPress={() => router.push(`/trip/${trip.id}`)}>
      {({ pressed }) => (
        <Card padded="sm" style={[styles.card, trip.draft && styles.draftCard, pressed && styles.pressed]}>
          <View style={styles.row}>
            <ModeChip mode={trip.dominantMode} />
            <View style={styles.body}>
              <Text variant="title" numberOfLines={1}>
                {placeLabel(startPlace)} → {placeLabel(endPlace)}
              </Text>
              <Text variant="meta" soft>
                {formatTime(trip.startTimeMs)} · {formatDuration(trip.durationS)}
                {modeSummary ? ` · ${modeSummary}` : ''}
              </Text>
              {segments ? (
                <View style={styles.barWrap}>
                  <ModeBar segments={segments} height={3} radius={2} gap={1} />
                </View>
              ) : null}
            </View>
            {trip.draft ? (
              <MaterialCommunityIcons
                name="wifi-off"
                size={16}
                color={colors.inkSoft}
                style={styles.draftBadge}
              />
            ) : null}
            <View style={styles.tail}>
              <Text variant="numberM">{distValue}</Text>
              <Text variant="meta" soft style={styles.unit}>
                {distUnit}
              </Text>
            </View>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space[4],
    marginVertical: space[1],
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  draftCard: {
    opacity: 0.55,
  },
  draftBadge: {
    marginRight: space[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  body: {
    flex: 1,
    gap: 2,
  },
  barWrap: {
    marginTop: space[1],
    width: '85%',
  },
  tail: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  unit: {
    marginTop: 0,
  },
});
