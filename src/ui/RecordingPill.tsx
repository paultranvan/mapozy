import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, space, radii } from '@/theme/tokens';
import { useI18n, type TranslationKey } from '@/i18n';
import { Text } from './Text';
import type { RecordingStatus } from '@/tracking/recording';

interface Props {
  status: RecordingStatus;
}

interface Visual {
  labelKey: TranslationKey;
  bg: string;
  fg: string;
  dot?: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}

function visualFor(status: RecordingStatus): Visual {
  switch (status) {
    case 'recording':
      return {
        labelKey: 'recording.recording',
        bg: colors.surfaceMuted,
        fg: colors.inkOnGround,
        dot: '#2ECC71',
      };
    case 'idle':
      return {
        labelKey: 'recording.idle',
        bg: colors.surfaceMuted,
        fg: colors.inkOnGroundSoft,
        dot: 'transparent',
      };
    case 'warning':
      return {
        labelKey: 'recording.notTracking',
        bg: colors.dangerSurface,
        fg: colors.danger,
        icon: 'alert-circle',
      };
  }
}

export function RecordingPill({ status }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const v = visualFor(status);
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      hitSlop={8}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: v.bg },
        pressed && { opacity: 0.85 },
      ]}
    >
      {v.icon ? (
        <MaterialCommunityIcons name={v.icon} size={14} color={v.fg} />
      ) : (
        <View
          style={[
            styles.dot,
            {
              backgroundColor: v.dot,
              borderColor:
                status === 'idle' ? colors.inkOnGroundSoft : 'transparent',
              borderWidth: status === 'idle' ? 1 : 0,
            },
          ]}
        />
      )}
      <Text variant="label" color={v.fg} style={{ marginLeft: 6 }}>
        {t(v.labelKey)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
