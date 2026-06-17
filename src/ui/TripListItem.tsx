import { View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Card } from './Card';
import { ModeChip } from './ModeChip';
import { ModeBar } from './ModeBar';
import { colors, space } from '@/theme/tokens';
import { formatDistance, formatDuration, formatTime } from '@/lib/format';
import { placeLabels } from '@/lib/placeLabel';
import { useUserPlaces } from '@/queries/usePlaces';
import { nearestUserPoi } from '@/lib/poiResolve';
import type { Trip, Place, DominantMode } from '@/types';

interface Props {
  trip: Trip;
  startPlace: Place | null | undefined;
  endPlace: Place | null | undefined;
  selectMode?: boolean;
  selected?: boolean;
  // 1-based ordinal shown as a leading badge, matching the numbered markers on
  // the day map so a trip in the list can be tied to its trace.
  index?: number;
  // When set, overrides the default "navigate to detail" body tap (used by the
  // day view to highlight the trip on the map instead). `onOpen`, when set,
  // shows a chevron that still opens the trip detail.
  onPress?: () => void;
  onOpen?: () => void;
  onLongPress?: (id: number) => void;
  onToggle?: (id: number) => void;
}

function labelFor(p: Place | null | undefined, poi: Place | null): string {
  if (poi?.name) return poi.name;
  return placeLabels(p, '—').short;
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
  index,
  onPress,
  onOpen,
  onLongPress,
  onToggle,
}: Props) {
  const router = useRouter();
  const userPlaces = useUserPlaces();
  const startPoi = startPlace
    ? nearestUserPoi(startPlace.latitude, startPlace.longitude, userPlaces.data ?? [])
    : null;
  const endPoi = endPlace
    ? nearestUserPoi(endPlace.latitude, endPlace.longitude, userPlaces.data ?? [])
    : null;
  const distance = formatDistance(trip.distanceM);
  const [distValue, distUnit] = distance.split(' ');
  const modeSummary = summarizeModes(trip);
  const segments = modeBarSegments(trip);

  const handlePress = () => {
    if (selectMode) {
      if (trip.id != null) onToggle?.(trip.id);
    } else if (onPress) {
      onPress();
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
          style={[
            styles.card,
            trip.draft && styles.draftCard,
            pressed && styles.pressed,
            selected && styles.selected,
          ]}
        >
          <View style={styles.row}>
            {selectMode ? (
              <MaterialCommunityIcons
                name={selected ? 'check-circle' : 'circle-outline'}
                size={24}
                color={selected ? colors.accent : colors.inkOnGroundSoft}
              />
            ) : null}
            {index != null && !selectMode ? (
              <View style={styles.indexBadge}>
                <Text variant="meta" style={styles.indexText}>
                  {index}
                </Text>
              </View>
            ) : null}
            <ModeChip mode={trip.dominantMode} />
            <View style={styles.body}>
              <Text variant="title" numberOfLines={1}>
                {labelFor(startPlace, startPoi)} → {labelFor(endPlace, endPoi)}
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
              {trip.draft ? (
                <Text variant="meta" soft>
                  Tap refresh to finish classifying
                </Text>
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
            {onOpen ? (
              <Pressable onPress={onOpen} hitSlop={8} style={styles.openBtn}>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={22}
                  color={colors.inkSoft}
                />
              </Pressable>
            ) : null}
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
  selected: {
    backgroundColor: colors.accentSoft,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  indexBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.deep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtn: {
    marginLeft: space[1],
    marginRight: -space[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    color: colors.surface,
    fontWeight: '700',
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
