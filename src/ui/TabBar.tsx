import { View, Pressable, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, space } from '@/theme/tokens';
import { Text } from './Text';

const TAB_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  index: 'map-outline',
  stats: 'chart-arc',
  settings: 'cog-outline',
};

const TAB_LABELS: Record<string, string> = {
  index: 'Trips',
  stats: 'Stats',
  settings: 'Settings',
};

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, space[2]) },
      ]}
    >
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        return (
          <TabItem
            key={route.key}
            name={route.name}
            isFocused={isFocused}
            onPress={onPress}
          />
        );
      })}
    </View>
  );
}

function TabItem({
  name,
  isFocused,
  onPress,
}: {
  name: string;
  isFocused: boolean;
  onPress: () => void;
}) {
  const icon = TAB_ICONS[name] ?? 'circle-outline';
  const label = TAB_LABELS[name] ?? name;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: isFocused ? 1.08 : 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  }, [isFocused, scale]);

  return (
    <Pressable onPress={onPress} style={styles.item} hitSlop={6}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <MaterialCommunityIcons
          name={icon}
          size={24}
          color={isFocused ? colors.accent : colors.inkOnGroundSoft}
        />
      </Animated.View>
      {isFocused ? (
        <Text variant="label" onGround style={styles.label}>
          {label}
        </Text>
      ) : (
        <View style={styles.labelSpacer} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.ground,
    paddingTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(234, 227, 208, 0.10)',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[2],
    gap: 2,
  },
  label: {
    marginTop: 2,
  },
  labelSpacer: {
    height: 14,
  },
});
