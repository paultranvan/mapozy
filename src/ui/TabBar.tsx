import { View, Pressable, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, space } from '@/theme/tokens';
import { Text } from './Text';

const TAB_ICONS: Record<string, { active: keyof typeof MaterialCommunityIcons.glyphMap; inactive: keyof typeof MaterialCommunityIcons.glyphMap }> = {
  index: { active: 'map', inactive: 'map-outline' },
  stats: { active: 'chart-arc', inactive: 'chart-arc' },
  places: { active: 'map-marker-multiple', inactive: 'map-marker-multiple-outline' },
  settings: { active: 'cog', inactive: 'cog-outline' },
};

const TAB_LABELS: Record<string, string> = {
  index: 'Trips',
  stats: 'Stats',
  places: 'Places',
  settings: 'Settings',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
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
  const icons = TAB_ICONS[name] ?? { active: 'circle', inactive: 'circle-outline' };
  const label = TAB_LABELS[name] ?? name;
  const iconLift = useRef(new Animated.Value(isFocused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(iconLift, {
      toValue: isFocused ? 1 : 0,
      useNativeDriver: true,
      speed: 28,
      bounciness: 6,
    }).start();
  }, [isFocused, iconLift]);

  const translateY = iconLift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1],
  });

  return (
    <Pressable onPress={onPress} style={styles.item} hitSlop={6}>
      <Animated.View
        style={[
          styles.iconWrap,
          isFocused && styles.iconWrapActive,
          { transform: [{ translateY }] },
        ]}
      >
        <MaterialCommunityIcons
          name={isFocused ? icons.active : icons.inactive}
          size={22}
          color={isFocused ? colors.accent : colors.inkSoft}
        />
      </Animated.View>
      <Text
        variant="label"
        color={isFocused ? colors.ink : colors.inkSoft}
        style={isFocused ? [styles.label, styles.labelActive] : styles.label}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.ground,
    paddingTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[1],
    gap: 2,
  },
  iconWrap: {
    width: 44,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: colors.accentSoft,
  },
  label: {
    marginTop: 2,
  },
  labelActive: {
    fontWeight: '600',
  },
});
