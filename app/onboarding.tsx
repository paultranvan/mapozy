import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '@/db/DbContext';
import { setSetting, SETTING_KEYS } from '@/db/settings';
import {
  requestForegroundPermissions,
  requestBackgroundLocation,
} from '@/tracking/permissions';
import { startTracking } from '@/tracking/tracker';
import { Text } from '@/ui/Text';
import { colors, radii, space } from '@/theme/tokens';

export default function OnboardingScreen() {
  const router = useRouter();
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
      style={{ flex: 1, backgroundColor: colors.ground }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + space[5] }]}
    >
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === step ? colors.accent : 'rgba(234, 227, 208, 0.25)',
              },
            ]}
          />
        ))}
      </View>

      {step === 0 && (
        <View style={styles.step}>
          <MaterialCommunityIcons
            name="compass-outline"
            size={88}
            color={colors.inkOnGround}
          />
          <Text variant="displayL" onGround align="center" style={styles.title}>
            Welcome to Mapozy
          </Text>
          <Text variant="body" onGround soft align="center" style={styles.body}>
            Track your trips and explore your stats — all on your device, nothing leaves your phone.
          </Text>
          <PrimaryButton label="Get started" onPress={() => setStep(1)} />
          <TextLink label="Skip" onPress={onSkip} />
        </View>
      )}

      {step === 1 && (
        <View style={styles.step}>
          <MaterialCommunityIcons
            name="shield-outline"
            size={88}
            color={colors.inkOnGround}
          />
          <Text variant="displayL" onGround align="center" style={styles.title}>
            Permissions
          </Text>
          <View style={styles.permList}>
            <PermissionRow icon="crosshairs-gps" label="Location" body="To record your trips." />
            <PermissionRow
              icon="run"
              label="Physical activity"
              body="To detect walking / cycling / driving."
            />
            <PermissionRow
              icon="bell-outline"
              label="Notifications"
              body="Required by Android for background tracking."
            />
          </View>
          <PrimaryButton
            label={requesting ? 'Requesting…' : 'Grant'}
            onPress={onGrantPermissions}
            disabled={requesting}
          />
          {permResult && !permResult.fineLocation && (
            <Text variant="meta" onGround style={styles.error}>
              Location was denied. Re-launch the dialog or grant it in Android settings.
            </Text>
          )}
        </View>
      )}

      {step === 2 && (
        <View style={styles.step}>
          <MaterialCommunityIcons
            name="check-circle-outline"
            size={88}
            color={colors.inkOnGround}
          />
          <Text variant="displayL" onGround align="center" style={styles.title}>
            Ready
          </Text>
          <Text variant="body" onGround soft align="center" style={styles.body}>
            Tracking starts now. A persistent notification keeps it alive in the background.
          </Text>
          {permResult && !permResult.backgroundLocation && (
            <Text variant="meta" onGround align="center" style={styles.error}>
              Background location was not granted. Tracking will pause when the app is backgrounded. Grant "Allow all the time" in Android settings for full coverage.
            </Text>
          )}
          <PrimaryButton label="Start tracking" onPress={onStartTracking} />
        </View>
      )}
    </ScrollView>
  );
}

function PermissionRow({ icon, label, body }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; body: string }) {
  return (
    <View style={styles.permRow}>
      <View style={styles.permIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.ground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="title" onGround>
          {label}
        </Text>
        <Text variant="meta" onGround soft>
          {body}
        </Text>
      </View>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryBtn,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.6 },
      ]}
    >
      <Text variant="label" color={colors.ground}>
        {label}
      </Text>
    </Pressable>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10}>
      <Text variant="label" onGround soft style={styles.link}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[5],
    gap: space[5],
    alignItems: 'center',
    minHeight: '100%',
  },
  dots: {
    flexDirection: 'row',
    gap: space[2],
    marginBottom: space[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  step: {
    width: '100%',
    alignItems: 'center',
    gap: space[3],
  },
  title: {
    marginTop: space[3],
  },
  body: {
    lineHeight: 22,
    paddingHorizontal: space[3],
  },
  permList: {
    alignSelf: 'stretch',
    gap: space[3],
    marginVertical: space[3],
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  permIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.chip,
    backgroundColor: colors.inkOnGround,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: space[2],
    alignSelf: 'stretch',
    paddingVertical: space[3],
    borderRadius: radii.pill,
    backgroundColor: colors.inkOnGround,
    alignItems: 'center',
  },
  link: {
    textDecorationLine: 'underline',
    marginTop: space[1],
  },
  error: {
    marginTop: space[2],
    color: '#F2C9A2',
  },
});
