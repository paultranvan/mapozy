import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  Alert,
  Switch,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
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
import { shareDb } from '@/lib/shareDb';
import { importDb, InvalidDatabaseError } from '@/lib/importDb';
import * as DocumentPicker from 'expo-document-picker';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { TrackingHealth } from '@/ui/TrackingHealth';
import { colors, space, radii } from '@/theme/tokens';
import { useTrackingHealth } from '@/tracking/useTrackingHealth';
import { getInterruptions, type Interruption } from '@/tracking/interruptions';
import { format } from 'date-fns';

export default function SettingsScreen() {
  const db = useDb();
  const qc = useQueryClient();
  const router = useRouter();

  const [trackingOn, setTrackingOn] = useState(false);
  const [tripCount, setTripCount] = useState(0);
  const [rawCount, setRawCount] = useState(0);
  const [batteryUnrestricted, setBatteryUnrestricted] = useState(false);
  const [interruptions, setInterruptions] = useState<Interruption[] | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [homeWorkBusy, setHomeWorkBusy] = useState(false);
  const health = useTrackingHealth();

  const refreshCounts = useCallback(async () => {
    setTripCount(await countTrips(db));
    setRawCount(await countUnconsumedPoints(db));
  }, [db]);

  useEffect(() => {
    (async () => {
      setTrackingOn(await isTracking());
      await refreshCounts();
      setBatteryUnrestricted(await MapozyTracker.isIgnoringBatteryOptimizations());
      const now = Date.now();
      const result = await getInterruptions(db, {
        intervalMs: 15 * 60_000,
        nowMs: now,
        sinceMs: now - 14 * 24 * 60 * 60_000,
      });
      setInterruptions(result);
    })();
  }, [db, refreshCounts]);

  // The native tracker keeps inserting points while this screen is open, so a
  // count fetched only on mount goes stale (and then appears to "jump up" after
  // Force pipeline). Re-read it whenever the tab regains focus so the number
  // the user sees is current.
  useFocusEffect(
    useCallback(() => {
      void refreshCounts();
    }, [refreshCounts])
  );

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
    if (pipelineBusy) return;
    setPipelineBusy(true);
    try {
      await runPipelineAndInvalidate(db, qc);
      await refreshCounts();
      Alert.alert('Pipeline complete', 'Trips have been refreshed.');
    } catch (e) {
      Alert.alert('Pipeline failed', String(e));
    } finally {
      setPipelineBusy(false);
    }
  }

  async function runHomeWork() {
    if (homeWorkBusy) return;
    setHomeWorkBusy(true);
    try {
      const r = await detectHomeAndWork(db);
      await qc.invalidateQueries({ queryKey: ['places'] });
      Alert.alert(
        'Home/work detection',
        `Home place: ${r.homeId ?? 'none'}\nWork place: ${r.workId ?? 'none'}`
      );
    } finally {
      setHomeWorkBusy(false);
    }
  }

  async function onSendDataToPaul() {
    try {
      await sendDbToPaul(db);
    } catch (e) {
      Alert.alert('Could not send data', String(e));
    }
  }

  async function onShareDb() {
    try {
      await shareDb(db);
    } catch (e) {
      Alert.alert('Could not share database', String(e));
    }
  }

  async function onImportDb() {
    let picked: DocumentPicker.DocumentPickerAsset;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      picked = result.assets[0]!;
    } catch (e) {
      Alert.alert('Could not pick file', String(e));
      return;
    }
    Alert.alert(
      'Replace database?',
      `Overwrite the current Mapozy database with "${picked.name}"? ` +
        `Your existing data is backed up to mapozy.db.preimport but the app needs to be closed and reopened to load the new file.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            try {
              // Quiet the native side so it stops writing to the file we're
              // about to swap. Tracking re-enables on the next app start if
              // the user had it on (per the persisted setting).
              try {
                await stopTracking();
              } catch {
                // best effort
              }
              const r = await importDb(picked.uri);
              Alert.alert(
                'Imported',
                `Wrote ${Math.round(r.sourceSize / 1024)} KB. Close the app from recents and reopen it to see the new data.`
              );
            } catch (e) {
              const msg =
                e instanceof InvalidDatabaseError
                  ? e.message
                  : `Import failed: ${String(e)}`;
              Alert.alert('Import failed', msg);
            }
          },
        },
      ]
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
            // Settings that reference deleted rows would otherwise dangle
            // (e.g. last_known_place_id -> non-existent place id, causing
            // FK violations on the next pipeline run). Reset AUTOINCREMENT
            // counters too so next inserts start at id=1, matching the
            // intent of "wipe everything".
            await db.runAsync(
              `DELETE FROM settings WHERE key = ?`,
              SETTING_KEYS.LAST_KNOWN_PLACE_ID
            );
            await db.runAsync(
              `DELETE FROM sqlite_sequence WHERE name IN ('trips','sections','places','raw_points','raw_activities')`
            );
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
              <Text variant="title">
                {trackingOn ? 'Tracking active' : 'Paused'}
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
          <TrackingHealth
            snapshot={health.snapshot}
            pointsToday={health.pointsToday}
            onRefresh={health.refresh}
          />
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
          Tracking interruptions
        </Text>
        <Card style={styles.card}>
          {interruptions === null ? (
            <Text variant="meta" soft>
              Loading…
            </Text>
          ) : interruptions.length === 0 ? (
            <Text variant="meta" soft>
              No interruptions in the last 14 days.
            </Text>
          ) : (
            interruptions.slice(0, 5).map((item, idx) => (
              <View key={idx}>
                {idx > 0 && <View style={styles.divider} />}
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text variant="title">
                      {format(item.startMs, 'MMM d HH:mm')}
                      {' – '}
                      {format(item.endMs, 'HH:mm')}
                      {' · '}
                      {formatDuration(item.durationMs)}
                    </Text>
                    <Text variant="meta" soft>
                      {causeLabel(item.cause)}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
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
                {rawCount} unprocessed {rawCount === 1 ? 'point' : 'points'}
              </Text>
              {rawCount > 0 ? (
                <Text variant="meta" soft style={styles.unprocessedHint}>
                  Points from a trip in progress stay here until you arrive
                  somewhere — the count drops once the trip closes.
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.buttonRow}>
            <SecondaryButton
              onPress={runPipeline}
              label="Force pipeline"
              busy={pipelineBusy}
            />
            <SecondaryButton
              onPress={runHomeWork}
              label="Detect home/work"
              busy={homeWorkBusy}
            />
          </View>
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={onShareDb}>
            <View style={{ flex: 1 }}>
              <Text variant="title">Share database file…</Text>
              <Text variant="meta" soft>
                Opens the system share sheet so you can send the DB anywhere (Claude, Drive, email).
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
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
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={onImportDb}>
            <View style={{ flex: 1 }}>
              <Text variant="title">Import database…</Text>
              <Text variant="meta" soft>
                Replace the current database with a .db file picked from the device. Used for restoring backups and debugging.
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
                Version {Constants.expoConfig?.version ?? 'unknown'} · All data stays on your device.
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

function SecondaryButton({
  label,
  onPress,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.secondaryBtn,
        styles.secondaryBtnRow,
        busy && { opacity: 0.6 },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.ink} /> : null}
      <Text variant="label">{busy ? 'Working…' : label}</Text>
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

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

function causeLabel(cause: Interruption['cause']): string {
  switch (cause) {
    case 'device_off':
      return 'Phone was off';
    case 'killed_recovered':
      return 'Phone stopped the app (recovered)';
    case 'killed_until_reopen':
      return 'Phone stopped the app until reopened';
    case 'ongoing':
      return 'Tracking currently interrupted';
  }
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
  unprocessedHint: {
    marginTop: space[1],
    opacity: 0.8,
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
  secondaryBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
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
