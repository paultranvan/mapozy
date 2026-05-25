import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, type as typeTokens, type TypeVariant } from '@/theme/tokens';

interface Props extends Omit<RNTextProps, 'style'> {
  variant?: TypeVariant;
  onGround?: boolean;
  soft?: boolean;
  align?: TextStyle['textAlign'];
  color?: string;
  style?: TextStyle | TextStyle[];
}

export function Text({
  variant = 'body',
  onGround = false,
  soft = false,
  align,
  color,
  style,
  ...rest
}: Props) {
  const t = typeTokens[variant];
  const resolved =
    color ??
    (onGround
      ? soft
        ? colors.inkOnGroundSoft
        : colors.inkOnGround
      : soft
      ? colors.inkSoft
      : colors.ink);

  return (
    <RNText
      {...rest}
      style={[
        {
          color: resolved,
          fontFamily: t.fontFamily,
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          ...(t.letterSpacing !== undefined ? { letterSpacing: t.letterSpacing } : null),
          ...(t.fontWeight ? { fontWeight: t.fontWeight } : null),
          ...(t.textTransform ? { textTransform: t.textTransform } : null),
          ...(t.fontVariant ? { fontVariant: t.fontVariant } : null),
          ...(align ? { textAlign: align } : null),
        },
        style as TextStyle,
      ]}
    />
  );
}
