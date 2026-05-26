import { useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { startTracking, stopTracking } from '@/tracking/tracker';
import { setSetting, SETTING_KEYS } from '@/db/settings';
import { useDb } from '@/db/DbContext';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { colors, space, radii } from '@/theme/tokens';
import type { HealthSnapshot, HealthState } from '@/tracking/health';

interface Props {
  snapshot: HealthSnapshot | null;
  pointsToday: number;
  onRefresh: () => Promise<void> | void;
}

function formatAge(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

interface Visual {
  dotColor: string;
  headline: string;
  subtitle: string | null;
  showRestart: boolean;
}

function visualFor(state: HealthState): Visual {
  switch (state.kind) {
    case 'off':
      return {
        dotColor: colors.divider,
        headline: 'Tracking is paused',
        subtitle: 'Tap to enable in Settings',
        showRestart: false,
      };
    case 'stopped':
      return {
        dotColor: '#C0392B',
        headline: 'Tracking stopped',
        subtitle: 'OS killed the service — restart to resume',
        showRestart: true,
      };
    case 'ar_silence_alert':
      return {
        dotColor: '#E67E22',
        headline: 'Activity recognition died',
        subtitle: 'Restart to re-subscribe AR',
        showRestart: true,
      };
    case 'stale':
      return {
        dotColor: '#E67E22',
        headline: 'Tracking — no recent data',
        subtitle: 'Restart to reset both streams',
        showRestart: true,
      };
    case 'quiet':
      return {
        dotColor: '#E1B91D',
        headline: 'Tracking · quiet stream',
        subtitle: 'Long stop, or starting to lag',
        showRestart: false,
      };
    case 'healthy':
      return {
        dotColor: '#2ECC71',
        headline: 'Tracking healthy',
        subtitle: null,
        showRestart: false,
      };
  }
}

export function TrackingHealthBanner({ snapshot, pointsToday, onRefresh }: Props) {
  const router = useRouter();
  const db = useDb();
  const visual = useMemo(
    () => (snapshot ? visualFor(snapshot.state) : null),
    [snapshot]
  );

  if (!snapshot || !visual) {
    return null;
  }

  async function doRestart() {
    try {
      await stopTracking();
    } catch {
      // ignore — service may already be dead
    }
    try {
      await startTracking();
      await setSetting(
        db,
        SETTING_KEYS.LAST_AUTO_RESTART_AT,
        String(Date.now())
      );
    } catch (e) {
      Alert.alert('Could not restart tracking', String(e));
    }
    await onRefresh();
  }

  function confirmRestart() {
    Alert.alert(
      'Restart tracking?',
      'This will stop the current GPS session and start a fresh one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restart', style: 'default', onPress: () => void doRestart() },
      ]
    );
  }

  function onPress() {
    if (snapshot && snapshot.state.kind === 'off') {
      router.push('/settings');
    }
  }

  return (
    <Pressable onPress={onPress} disabled={snapshot.state.kind !== 'off'}>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <View style={[styles.dot, { backgroundColor: visual.dotColor }]} />
          <View style={{ flex: 1 }}>
            <Text variant="title">{visual.headline}</Text>
            {visual.subtitle != null && (
              <Text variant="meta" soft>
                {visual.subtitle}
              </Text>
            )}
          </View>
          {visual.showRestart ? (
            <Pressable
              onPress={confirmRestart}
              style={({ pressed }) => [
                styles.restartBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text variant="label" color={colors.surface}>
                Restart
              </Text>
            </Pressable>
          ) : (
            <Text variant="meta" soft style={styles.pointsToday}>
              {pointsToday} pts today
            </Text>
          )}
        </View>
        <View style={styles.chipsRow}>
          <Chip
            icon="crosshairs-gps"
            label={`GPS · ${formatAge(snapshot.gpsAge)}`}
          />
          <Chip
            icon="walk"
            label={`Activity · ${formatAge(snapshot.activityAge)}`}
          />
          {snapshot.recentlyRestarted && snapshot.restartedAt != null && (
            <Chip
              icon="restart"
              label={`Restored at ${formatClock(snapshot.restartedAt)}`}
            />
          )}
        </View>
      </Card>
    </Pressable>
  );
}

function Chip({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.chip}>
      <MaterialCommunityIcons
        name={icon as never}
        size={14}
        color={colors.inkSoft}
      />
      <Text variant="meta" soft style={{ marginLeft: 4 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space[4],
    marginTop: space[3],
    gap: space[2],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pointsToday: {
    textAlign: 'right',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  restartBtn: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
