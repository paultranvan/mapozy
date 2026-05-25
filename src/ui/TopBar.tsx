import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, space } from '@/theme/tokens';
import { Text } from './Text';

interface Props {
  title: string;
  onBack?: () => void;
  right?: { icon: keyof typeof MaterialCommunityIcons.glyphMap; onPress: () => void };
}

export function TopBar({ title, onBack, right }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space[2] }]}>
      <View style={styles.left}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
            <MaterialCommunityIcons
              name="chevron-left"
              size={28}
              color={colors.inkOnGround}
            />
          </Pressable>
        ) : null}
      </View>
      <Text variant="display" onGround style={styles.title}>
        {title}
      </Text>
      <View style={styles.right}>
        {right ? (
          <Pressable onPress={right.onPress} hitSlop={12} style={styles.iconBtn}>
            <MaterialCommunityIcons
              name={right.icon}
              size={24}
              color={colors.inkOnGround}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[3],
    paddingBottom: space[2],
    backgroundColor: colors.ground,
  },
  left: {
    width: 44,
    alignItems: 'flex-start',
  },
  right: {
    width: 44,
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
