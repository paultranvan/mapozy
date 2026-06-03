import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  selectMode?: boolean;
  selected?: boolean;
  onLongPress?: (id: number) => void;
  onToggle?: (id: number) => void;
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

export function TripListItem({
  trip,
  startPlace,
  endPlace,
  selectMode = false,
  selected = false,
  onLongPress,
  onToggle,
}: Props) {
  const router = useRouter();
  const distance = formatDistance(trip.distanceM);
  const [distValue, distUnit] = distance.split(' ');
  const modeSummary = summarizeModes(trip);
  const segments = modeBarSegments(trip);

  const handlePress = () => {
    if (selectMode) {
      if (trip.id != null) onToggle?.(trip.id);
    } else {
      router.push(`/trip/${trip.id}`);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={() => {
        // Only enter select mode from a long-press; in select mode a long-press
        // must not reset an in-progress multi-selection.
        if (!selectMode && trip.id != null) onLongPress?.(trip.id);
      }}
      delayLongPress={300}
    >
      {({ pressed }) => (
        <Card
          padded="sm"
          style={[styles.card, pressed && styles.pressed, selected && styles.selected]}
        >
          <View style={styles.row}>
            {selectMode ? (
              <MaterialCommunityIcons
                name={selected ? 'check-circle' : 'circle-outline'}
                size={24}
                color={selected ? colors.accent : colors.inkOnGroundSoft}
              />
            ) : null}
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
  selected: {
    backgroundColor: colors.accentSoft,
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
