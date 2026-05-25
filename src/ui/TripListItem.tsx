import { View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { ModeIcon } from './ModeIcon';
import { formatDistance, formatDuration, formatTime } from '../lib/format';
import type { Trip, Place } from '../types';

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

function placeIcon(p: Place | null | undefined): keyof typeof MaterialCommunityIcons.glyphMap {
  if (p?.label === 'home') return 'home';
  if (p?.label === 'work') return 'briefcase';
  return 'map-marker';
}

export function TripListItem({ trip, startPlace, endPlace }: Props) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/trip/${trip.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface },
      ]}
      android_ripple={{ color: theme.colors.surfaceVariant }}
    >
      <View style={styles.leading}>
        <MaterialCommunityIcons
          name={placeIcon(startPlace)}
          size={28}
          color={theme.colors.onSurfaceVariant}
        />
        <ModeIcon mode={trip.dominantMode} size={20} />
      </View>
      <View style={styles.body}>
        <Text variant="bodyLarge" numberOfLines={1}>
          {placeLabel(startPlace)} → {placeLabel(endPlace)}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {formatTime(trip.startTimeMs)} · {formatDuration(trip.durationS)} · {formatDistance(trip.distanceM)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={24}
        color={theme.colors.onSurfaceVariant}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  leading: {
    width: 56,
    alignItems: 'center',
    gap: 4,
  },
  body: {
    flex: 1,
    gap: 2,
  },
});
