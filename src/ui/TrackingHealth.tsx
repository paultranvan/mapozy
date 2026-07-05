import { useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { restartTracking } from '@/tracking/tracker';
import { setSetting, SETTING_KEYS } from '@/db/settings';
import { useDb } from '@/db/DbContext';
import { Text } from '@/ui/Text';
import { colors, space, radii } from '@/theme/tokens';
import { useI18n, type TranslationKey } from '@/i18n';
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
  headlineKey: TranslationKey;
  subtitleKey: TranslationKey | null;
  showRestart: boolean;
}

function visualFor(state: HealthState): Visual {
  switch (state.kind) {
    case 'off':
      return {
        dotColor: colors.divider,
        headlineKey: 'trackingHealth.pausedTitle',
        subtitleKey: 'trackingHealth.pausedSubtitle',
        showRestart: false,
      };
    case 'stopped':
      return {
        dotColor: '#C0392B',
        headlineKey: 'trackingHealth.stoppedTitle',
        subtitleKey: 'trackingHealth.stoppedSubtitle',
        showRestart: true,
      };
    case 'ar_silence_alert':
      return {
        dotColor: '#E67E22',
        headlineKey: 'trackingHealth.arSilenceTitle',
        subtitleKey: 'trackingHealth.arSilenceSubtitle',
        showRestart: true,
      };
    case 'stale':
      return {
        dotColor: '#E67E22',
        headlineKey: 'trackingHealth.staleTitle',
        subtitleKey: 'trackingHealth.staleSubtitle',
        showRestart: true,
      };
    case 'quiet':
      return {
        dotColor: '#E1B91D',
        headlineKey: 'trackingHealth.quietTitle',
        subtitleKey: 'trackingHealth.quietSubtitle',
        showRestart: false,
      };
    case 'healthy':
      return {
        dotColor: '#2ECC71',
        headlineKey: 'trackingHealth.healthyTitle',
        subtitleKey: null,
        showRestart: false,
      };
  }
}

export function TrackingHealth({ snapshot, pointsToday, onRefresh }: Props) {
  const { t } = useI18n();
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
      await restartTracking();
      await setSetting(
        db,
        SETTING_KEYS.LAST_AUTO_RESTART_AT,
        String(Date.now())
      );
    } catch (e) {
      Alert.alert(t('trackingHealth.restartFailedTitle'), String(e));
    }
    await onRefresh();
  }

  function confirmRestart() {
    Alert.alert(
      t('trackingHealth.restartConfirmTitle'),
      t('trackingHealth.restartConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('trackingHealth.restart'),
          style: 'default',
          onPress: () => void doRestart(),
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: visual.dotColor }]} />
        <View style={{ flex: 1 }}>
          <Text variant="title">{t(visual.headlineKey)}</Text>
          {visual.subtitleKey != null && (
            <Text variant="meta" soft>
              {t(visual.subtitleKey)}
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
              {t('trackingHealth.restart')}
            </Text>
          </Pressable>
        ) : (
          <Text variant="meta" soft style={styles.pointsToday}>
            {t('trackingHealth.pointsToday', { count: pointsToday })}
          </Text>
        )}
      </View>
      <View style={styles.chipsRow}>
        <Chip
          icon="crosshairs-gps"
          label={t('trackingHealth.gpsChip', {
            age: formatAge(snapshot.gpsAge),
          })}
        />
        <Chip
          icon="walk"
          label={t('trackingHealth.activityChip', {
            age: formatAge(snapshot.activityAge),
          })}
        />
        {snapshot.recentlyRestarted && snapshot.restartedAt != null && (
          <Chip
            icon="restart"
            label={t('trackingHealth.restoredAt', {
              time: formatClock(snapshot.restartedAt),
            })}
          />
        )}
      </View>
    </View>
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
  container: {
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
