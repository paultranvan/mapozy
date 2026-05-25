import { useEffect, useState } from 'react';
import { ScrollView, View, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  List,
  Switch,
  Button,
  useTheme,
  Text,
  Divider,
} from 'react-native-paper';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useDb } from '@/db/DbContext';
import { getSetting, setSetting, SETTING_KEYS } from '@/db/settings';
import { countTrips, deleteAllTrips } from '@/db/trips';
import { countUnconsumedPoints } from '@/db/rawPoints';
import {
  startTracking,
  stopTracking,
  isTracking,
  runPipelineAndInvalidate,
} from '@/tracking/tracker';
import { detectHomeAndWork } from '@/stats/homeWorkDetection';
import { injectDemoTrip } from '@/lib/demoTrip';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const db = useDb();
  const qc = useQueryClient();
  const router = useRouter();

  const [trackingOn, setTrackingOn] = useState(false);
  const [tripCount, setTripCount] = useState(0);
  const [rawCount, setRawCount] = useState(0);

  useEffect(() => {
    (async () => {
      setTrackingOn(await isTracking());
      setTripCount(await countTrips(db));
      setRawCount(await countUnconsumedPoints(db));
    })();
  }, [db]);

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
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header style={{ paddingTop: insets.top }}>
        <Appbar.Content title="Settings" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.container}>
        <List.Section title="Tracking">
          <List.Item
            title="Tracking active"
            description={trackingOn ? 'Recording your trips' : 'Paused'}
            right={() => <Switch value={trackingOn} onValueChange={toggleTracking} />}
          />
        </List.Section>
        <Divider />

        <List.Section title="Data">
          <List.Item
            title={`${tripCount} trip${tripCount === 1 ? '' : 's'} stored`}
            description={`${rawCount} unprocessed points`}
            left={(p) => <List.Icon {...p} icon="database" />}
          />
          <View style={styles.actions}>
            <Button mode="outlined" onPress={runPipeline}>
              Force pipeline
            </Button>
            <Button mode="outlined" onPress={runHomeWork}>
              Detect home/work
            </Button>
            <Button mode="outlined" textColor={theme.colors.error} onPress={confirmClearAll}>
              Clear all
            </Button>
          </View>
        </List.Section>
        <Divider />

        <List.Section title="Debug">
          <List.Item
            title="Inject demo trip"
            description="Adds a synthetic walk → drive → walk trip"
            onPress={async () => {
              await injectDemoTrip(db);
              setTripCount(await countTrips(db));
              setRawCount(await countUnconsumedPoints(db));
              await qc.invalidateQueries();
              Alert.alert('Demo trip inserted', 'Check the Trips tab.');
            }}
          />
          <List.Item title="Reset onboarding" onPress={resetOnboarding} />
        </List.Section>
        <Divider />

        <List.Section title="About">
          <List.Item title="Mapozy" description="Version 0.1.0" />
          <Text variant="bodySmall" style={[styles.footer, { color: theme.colors.onSurfaceVariant }]}>
            All data stays on your device.
          </Text>
        </List.Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 32 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footer: {
    textAlign: 'center',
    marginTop: 16,
  },
});
