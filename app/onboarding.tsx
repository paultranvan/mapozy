import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Text,
  useTheme,
  Surface,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '@/db/DbContext';
import { setSetting, SETTING_KEYS } from '@/db/settings';
import {
  requestForegroundPermissions,
  requestBackgroundLocation,
} from '@/tracking/permissions';
import { startTracking } from '@/tracking/tracker';

export default function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const db = useDb();
  const [step, setStep] = useState(0);
  const [permResult, setPermResult] = useState<{
    fineLocation: boolean;
    backgroundLocation: boolean;
    activityRecognition: boolean;
    notifications: boolean;
  } | null>(null);
  const [requesting, setRequesting] = useState(false);

  async function onGrantPermissions() {
    setRequesting(true);
    try {
      const fg = await requestForegroundPermissions();
      // Background location must be requested AFTER fine location is granted,
      // or Android silently rejects it. If foreground was denied, skip bg.
      const bg = fg.fineLocation ? await requestBackgroundLocation() : false;
      setPermResult({ ...fg, backgroundLocation: bg });
      if (fg.fineLocation && fg.activityRecognition) {
        setStep(2);
      }
    } finally {
      setRequesting(false);
    }
  }

  async function onStartTracking() {
    await setSetting(db, SETTING_KEYS.ONBOARDING_DONE, '1');
    await setSetting(db, SETTING_KEYS.TRACKING_ENABLED, '1');
    try {
      await startTracking();
    } catch {
      // Surface error in Settings; onboarding should still complete.
    }
    router.replace('/');
  }

  async function onSkip() {
    await setSetting(db, SETTING_KEYS.ONBOARDING_DONE, '1');
    router.replace('/');
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}
    >
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === step ? theme.colors.primary : theme.colors.surfaceVariant,
              },
            ]}
          />
        ))}
      </View>

      {step === 0 && (
        <Surface style={styles.card} elevation={0}>
          <MaterialCommunityIcons name="map-marker-radius" size={72} color={theme.colors.primary} />
          <Text variant="headlineMedium" style={styles.title}>
            Welcome to Mapozy
          </Text>
          <Text variant="bodyLarge" style={styles.body}>
            Track your trips and explore your stats — all on your device, nothing leaves your phone.
          </Text>
          <Button mode="contained" onPress={() => setStep(1)} style={styles.button}>
            Get started
          </Button>
          <Button mode="text" onPress={onSkip}>
            Skip
          </Button>
        </Surface>
      )}

      {step === 1 && (
        <Surface style={styles.card} elevation={0}>
          <MaterialCommunityIcons name="shield-check" size={72} color={theme.colors.primary} />
          <Text variant="headlineMedium" style={styles.title}>
            Permissions
          </Text>
          <View style={{ alignSelf: 'stretch', gap: 12 }}>
            <PermissionRow icon="crosshairs-gps" label="Location" body="To record your trips." />
            <PermissionRow
              icon="run"
              label="Physical activity"
              body="To detect walking / cycling / driving."
            />
            <PermissionRow
              icon="bell"
              label="Notifications"
              body="Required by Android for background tracking."
            />
          </View>
          <Button
            mode="contained"
            onPress={onGrantPermissions}
            loading={requesting}
            style={styles.button}
          >
            Grant
          </Button>
          {permResult && !permResult.fineLocation && (
            <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>
              Location was denied. Re-launch the dialog or grant it in Android settings.
            </Text>
          )}
        </Surface>
      )}

      {step === 2 && (
        <Surface style={styles.card} elevation={0}>
          <MaterialCommunityIcons name="check-circle" size={72} color={theme.colors.primary} />
          <Text variant="headlineMedium" style={styles.title}>
            Ready
          </Text>
          <Text variant="bodyLarge" style={styles.body}>
            Tracking starts now. A persistent notification keeps it alive in the background.
          </Text>
          {permResult && !permResult.backgroundLocation && (
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.error, textAlign: 'center' }}
            >
              Background location was not granted. Tracking will pause when the app is
              backgrounded. Grant "Allow all the time" in Android settings for full coverage.
            </Text>
          )}
          <Button mode="contained" onPress={onStartTracking} style={styles.button}>
            Start tracking
          </Button>
        </Surface>
      )}
    </ScrollView>
  );
}

function PermissionRow({
  icon,
  label,
  body,
}: {
  icon: string;
  label: string;
  body: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.permRow}>
      <IconButton icon={icon} size={24} iconColor={theme.colors.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
          {label}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 24, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: {
    width: '100%',
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    gap: 16,
  },
  title: { textAlign: 'center', fontWeight: '600' },
  body: { textAlign: 'center', lineHeight: 22 },
  button: { marginTop: 8, alignSelf: 'stretch' },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
