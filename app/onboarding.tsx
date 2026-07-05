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
import { MapozyTracker } from 'mapozy-tracker';
import { Text } from '@/ui/Text';
import { useI18n } from '@/i18n';
import { colors, radii, space } from '@/theme/tokens';

export default function OnboardingScreen() {
  const router = useRouter();
  const { t } = useI18n();
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
  const [batteryExempt, setBatteryExempt] = useState<boolean | null>(null);

  async function onGrantPermissions() {
    setRequesting(true);
    try {
      const fg = await requestForegroundPermissions();
      const bg = fg.fineLocation ? await requestBackgroundLocation() : false;
      setPermResult({ ...fg, backgroundLocation: bg });
      if (fg.fineLocation && fg.activityRecognition) {
        const exempt = await MapozyTracker.isIgnoringBatteryOptimizations();
        setBatteryExempt(exempt);
        setStep(exempt ? 3 : 2);
      }
    } finally {
      setRequesting(false);
    }
  }

  async function onRequestBatteryExemption() {
    setRequesting(true);
    try {
      await MapozyTracker.requestIgnoreBatteryOptimizations();
      const exempt = await MapozyTracker.isIgnoringBatteryOptimizations();
      setBatteryExempt(exempt);
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
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === step ? colors.accent : 'rgba(26, 34, 48, 0.15)',
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
            {t('onboarding.welcomeTitle')}
          </Text>
          <Text variant="body" onGround soft align="center" style={styles.body}>
            {t('onboarding.welcomeBody')}
          </Text>
          <PrimaryButton label={t('onboarding.getStarted')} onPress={() => setStep(1)} />
          <TextLink label={t('onboarding.skip')} onPress={onSkip} />
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
            {t('onboarding.permissionsTitle')}
          </Text>
          <View style={styles.permList}>
            <PermissionRow
              icon="crosshairs-gps"
              label={t('onboarding.permLocation')}
              body={t('onboarding.permLocationBody')}
            />
            <PermissionRow
              icon="run"
              label={t('onboarding.permActivity')}
              body={t('onboarding.permActivityBody')}
            />
            <PermissionRow
              icon="bell-outline"
              label={t('onboarding.permNotifications')}
              body={t('onboarding.permNotificationsBody')}
            />
          </View>
          <PrimaryButton
            label={requesting ? t('onboarding.requesting') : t('onboarding.grant')}
            onPress={onGrantPermissions}
            disabled={requesting}
          />
          {permResult && !permResult.fineLocation && (
            <Text variant="meta" onGround style={styles.error}>
              {t('onboarding.locationDenied')}
            </Text>
          )}
        </View>
      )}

      {step === 2 && (
        <View style={styles.step}>
          <MaterialCommunityIcons
            name="battery-charging-outline"
            size={88}
            color={colors.inkOnGround}
          />
          <Text variant="displayL" onGround align="center" style={styles.title}>
            {t('onboarding.batteryTitle')}
          </Text>
          <Text variant="body" onGround soft align="center" style={styles.body}>
            {t('onboarding.batteryBody')}
          </Text>
          {batteryExempt && (
            <Text variant="meta" onGround align="center" style={styles.body}>
              {t('onboarding.batteryGranted')}
            </Text>
          )}
          {!batteryExempt && (
            <PrimaryButton
              label={requesting ? t('onboarding.requesting') : t('onboarding.allowBatteryExemption')}
              onPress={onRequestBatteryExemption}
              disabled={requesting}
            />
          )}
          <TextLink label={t('onboarding.continue')} onPress={() => setStep(3)} />
        </View>
      )}

      {step === 3 && (
        <View style={styles.step}>
          <MaterialCommunityIcons
            name="check-circle-outline"
            size={88}
            color={colors.inkOnGround}
          />
          <Text variant="displayL" onGround align="center" style={styles.title}>
            {t('onboarding.readyTitle')}
          </Text>
          <Text variant="body" onGround soft align="center" style={styles.body}>
            {t('onboarding.readyBody')}
          </Text>
          {permResult && !permResult.backgroundLocation && (
            <Text variant="meta" onGround align="center" style={styles.error}>
              {t('onboarding.backgroundDenied')}
            </Text>
          )}
          <PrimaryButton label={t('onboarding.startTracking')} onPress={onStartTracking} />
        </View>
      )}
    </ScrollView>
  );
}

function PermissionRow({ icon, label, body }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; body: string }) {
  return (
    <View style={styles.permRow}>
      <View style={styles.permIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.surface} />
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
      <Text variant="label" color={colors.surface}>
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
    backgroundColor: colors.deep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: space[2],
    alignSelf: 'stretch',
    paddingVertical: space[3],
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  link: {
    textDecorationLine: 'underline',
    marginTop: space[1],
  },
  error: {
    marginTop: space[2],
    color: colors.danger,
  },
});
