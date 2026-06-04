import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, space } from '@/theme/tokens';
import { Text } from './Text';

interface Props {
  count: number;
  onCancel: () => void;
  onDelete: () => void;
  onRecompute: () => void;
}

export function TripSelectionBar({ count, onCancel, onDelete, onRecompute }: Props) {
  const insets = useSafeAreaInsets();
  const disabled = count === 0;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space[2] }]}>
      <Pressable onPress={onCancel} hitSlop={12} style={styles.iconBtn}>
        <MaterialCommunityIcons name="close" size={24} color={colors.inkOnGround} />
      </Pressable>
      <Text variant="display" onGround style={styles.title}>
        {count} selected
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onRecompute}
          disabled={disabled}
          hitSlop={12}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons
            name="refresh"
            size={24}
            color={disabled ? colors.inkOnGroundSoft : colors.accent}
          />
        </Pressable>
        <Pressable
          onPress={onDelete}
          disabled={disabled}
          hitSlop={12}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons
            name="trash-can-outline"
            size={24}
            color={disabled ? colors.inkOnGroundSoft : colors.danger}
          />
        </Pressable>
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
    gap: space[2],
  },
  title: {
    flex: 1,
    textAlign: 'left',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
