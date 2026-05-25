import { View, StyleSheet } from 'react-native';
import { Text, useTheme, Surface } from 'react-native-paper';

interface Props {
  label: string;
  value: string;
  caption?: string;
}

export function KpiCard({ label, value, caption }: Props) {
  const theme = useTheme();
  return (
    <Surface style={[styles.card, { backgroundColor: theme.colors.surfaceVariant }]} elevation={0}>
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
      <Text variant="headlineMedium" style={styles.value}>
        {value}
      </Text>
      {caption ? (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {caption}
        </Text>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    gap: 4,
    minWidth: 0,
  },
  value: {
    fontWeight: '600',
  },
});
