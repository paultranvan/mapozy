import { useEffect, useState } from 'react';
import { ScrollView, View, StyleSheet, Alert, Switch, Pressable } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDb } from '@/db/DbContext';
import { setSetting, SETTING_KEYS } from '@/db/settings';
import { countTrips, deleteAllTrips } from '@/db/trips';
import { countUnconsumedPoints } from '@/db/rawPoints';
import {
  startTracking,
  stopTracking,
  isTracking,
  runPipelineAndInvalidate,
} from '@/tracking/tracker';
import { MapozyTracker } from 'mapozy-tracker';
import { detectHomeAndWork } from '@/stats/homeWorkDetection';
import { injectDemoTrip } from '@/lib/demoTrip';
import { sendDbToPaul } from '@/lib/sendDbToPaul';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { colors, space, radii } from '@/theme/tokens';

export default function SettingsScreen() {
  const db = useDb();
  const qc = useQueryClient();
  const router = useRouter();

  const [trackingOn, setTrackingOn] = useState(false);
  const [tripCount, setTripCount] = useState(0);
  const [rawCount, setRawCount] = useState(0);
  const [batteryUnrestricted, setBatteryUnrestricted] = useState(false);

  useEffect(() => {
    (async () => {
      setTrackingOn(await isTracking());
      setTripCount(await countTrips(db));
      setRawCount(await countUnconsumedPoints(db));
      setBatteryUnrestricted(await MapozyTracker.isIgnoringBatteryOptimizations());
    })();
  }, [db]);

  async function requestBatteryExemption() {
    await MapozyTracker.requestIgnoreBatteryOptimizations();
    setTimeout(async () => {
      setBatteryUnrestricted(await MapozyTracker.isIgnoringBatteryOptimizations());
    }, 1500);
  }

  async function toggleTracking(value: boolean) {
    try {
      if (value) {
        await startTracking();
      } else {
        await stopTracking();
      }
      await setSetting(db, SETTING_KEYS.TRACKING_ENABLED, value ? '1' : '0');
      setTrackingOn(value);
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }

  async function runPipeline() {
    await runPipelineAndInvalidate(db, qc);
    setTripCount(await countTrips(db));
    setRawCount(await countUnconsumedPoints(db));
    Alert.alert('Pipeline complete', 'Trips have been refreshed.');
  }

  async function runHomeWork() {
    const r = await detectHomeAndWork(db);
    await qc.invalidateQueries({ queryKey: ['places'] });
    Alert.alert(
      'Home/work detection',
      `Home place: ${r.homeId ?? 'none'}\nWork place: ${r.workId ?? 'none'}`
    );
  }

  async function onSendDataToPaul() {
    try {
      await sendDbToPaul(db);
    } catch (e) {
      Alert.alert('Could not send data', String(e));
    }
  }

  function confirmClearAll() {
    Alert.alert(
      'Clear all data?',
      'This deletes every trip stored on this device. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteAllTrips(db);
            await db.runAsync(`DELETE FROM raw_points`);
            await db.runAsync(`DELETE FROM raw_activities`);
            await db.runAsync(`DELETE FROM places`);
            setTripCount(0);
            setRawCount(0);
            await qc.invalidateQueries();
          },
        },
      ]
    );
  }

  async function resetOnboarding() {
    await setSetting(db, SETTING_KEYS.ONBOARDING_DONE, '0');
    router.replace('/onboarding');
  }

  return (
    <View style={styles.root}>
      <TopBar title="Settings" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="display" onGround style={styles.section}>
          Tracking
        </Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="title">Tracking active</Text>
              <Text variant="meta" soft>
                {trackingOn ? 'Recording your trips' : 'Paused'}
              </Text>
            </View>
            <Switch
              value={trackingOn}
              onValueChange={toggleTracking}
              trackColor={{ true: colors.accentSoft, false: colors.divider }}
              thumbColor={trackingOn ? colors.accent : colors.surface}
            />
          </View>
          <View style={styles.divider} />
          <Pressable
            style={styles.actionRow}
            onPress={requestBatteryExemption}
            disabled={batteryUnrestricted}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title">
                {batteryUnrestricted
                  ? 'Battery optimization disabled'
                  : 'Disable battery optimization'}
              </Text>
              <Text variant="meta" soft>
                {batteryUnrestricted
                  ? 'The OS is allowed to keep tracking alive in the background'
                  : 'Required on OnePlus/aggressive OEMs to avoid data gaps'}
              </Text>
            </View>
            {!batteryUnrestricted && (
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color={colors.inkSoft}
              />
            )}
          </Pressable>
        </Card>

        <Text variant="display" onGround style={styles.section}>
          Data
        </Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <MaterialCommunityIcons name="database-outline" size={22} color={colors.inkSoft} />
            <View style={{ flex: 1, marginLeft: space[3] }}>
              <Text variant="title">
                {tripCount} {tripCount === 1 ? 'trip' : 'trips'} stored
              </Text>
              <Text variant="meta" soft>
                {rawCount} unprocessed points
              </Text>
            </View>
          </View>
          <View style={styles.buttonRow}>
            <SecondaryButton onPress={runPipeline} label="Force pipeline" />
            <SecondaryButton onPress={runHomeWork} label="Detect home/work" />
          </View>
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={onSendDataToPaul}>
            <View style={{ flex: 1 }}>
              <Text variant="title">Send data to Paul</Text>
              <Text variant="meta" soft>
                Attaches your full Mapozy database to an email for debugging help.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
        </Card>

        <Text variant="display" onGround style={styles.section}>
          Debug
        </Text>
        <Card style={styles.card}>
          <Pressable
            style={styles.actionRow}
            onPress={async () => {
              await injectDemoTrip(db);
              setTripCount(await countTrips(db));
              setRawCount(await countUnconsumedPoints(db));
              await qc.invalidateQueries();
              Alert.alert('Demo trip inserted', 'Check the Trips tab.');
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title">Inject demo trip</Text>
              <Text variant="meta" soft>
                Adds a synthetic walk → drive → walk trip
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={resetOnboarding}>
            <Text variant="title">Reset onboarding</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
        </Card>

        <Text variant="display" onGround style={styles.section}>
          About
        </Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="title">Mapozy</Text>
              <Text variant="meta" soft>
                Version 0.1.0 · All data stays on your device.
              </Text>
            </View>
          </View>
        </Card>

        <Text variant="display" onGround style={[styles.section, styles.dangerTitle]}>
          Danger zone
        </Text>
        <Card style={[styles.card, styles.dangerCard]}>
          <DangerButton onPress={confirmClearAll} label="Clear all data" />
        </Card>
      </ScrollView>
    </View>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryBtn,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Text variant="label">{label}</Text>
    </Pressable>
  );
}

function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dangerBtn,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text variant="label" color={colors.surface}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  scroll: { paddingBottom: space[6] },
  section: {
    marginTop: space[4],
    marginHorizontal: space[4],
    marginBottom: space[1],
  },
  dangerTitle: {
    marginTop: space[6],
    color: undefined,
  },
  card: {
    marginHorizontal: space[4],
    gap: space[3],
  },
  dangerCard: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    shadowOpacity: 0,
    elevation: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space[2],
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  secondaryBtn: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  dangerBtn: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
});
