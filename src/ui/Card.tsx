import { View, StyleSheet, type ViewProps } from 'react-native';
import { colors, radii, space } from '@/theme/tokens';

interface Props extends ViewProps {
  padded?: boolean | 'sm' | 'md' | 'lg';
}

export function Card({ padded = 'md', style, children, ...rest }: Props) {
  const padding =
    padded === false
      ? 0
      : padded === 'sm'
      ? space[3]
      : padded === 'lg'
      ? space[5]
      : space[4];

  return (
    <View {...rest} style={[styles.card, { padding }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 2,
  },
});
