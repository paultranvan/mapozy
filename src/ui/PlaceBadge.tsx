import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { resolveCategory } from './placeCategories';
import { useCategories } from '@/queries/useCategories';

export function PlaceBadge({
  category,
  size = 32,
}: {
  category: string | null;
  size?: number;
}) {
  const categories = useCategories();
  const meta = resolveCategory(category, categories);
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, backgroundColor: meta.color, borderRadius: size / 2 },
      ]}
    >
      <MaterialCommunityIcons name={meta.icon} size={size * 0.55} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
