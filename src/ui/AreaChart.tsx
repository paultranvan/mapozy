import { View, StyleSheet } from 'react-native';
import Svg, { Path, Line, G, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { useMemo, useState } from 'react';
import { Text } from './Text';
import { colors, space } from '@/theme/tokens';

interface Point {
  label: string;
  value: number;
}

interface Props {
  data: Point[];
  height?: number;
  yLabelSuffix?: string;
}

// Exact readout for the touched point — full precision matters here (tester:
// "je ne peux pas consulter le nombre de km exacts"), unlike the axis labels.
function formatExact(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

const PAD_LEFT = 8;
const PAD_RIGHT = 8;

export function AreaChart({ data, height = 160, yLabelSuffix = '' }: Props) {
  const [width, setWidth] = useState(0);
  // Index of the touched point; drag to scrub, stays until the next touch.
  const [selected, setSelected] = useState<number | null>(null);

  const { areaPath, linePath, dots, maxTick, xTicks } = useMemo(() => {
    if (data.length === 0 || width === 0) {
      return {
        areaPath: '',
        linePath: '',
        dots: [] as { x: number; y: number; value: number; label: string }[],
        maxTick: '',
        xTicks: [] as { x: number; label: string }[],
      };
    }
    const padTop = 18;
    const padBottom = 26;
    const innerW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
    const innerH = Math.max(1, height - padTop - padBottom);

    const maxVal = Math.max(1, ...data.map((d) => d.value));
    const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

    const points = data.map((d, i) => {
      const x = PAD_LEFT + (data.length > 1 ? i * stepX : innerW / 2);
      const y = padTop + innerH - (d.value / maxVal) * innerH;
      return { x, y, value: d.value, label: d.label };
    });

    const lp = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');

    const first = points[0]!;
    const last = points[points.length - 1]!;
    const ap = `${lp} L ${last.x.toFixed(2)} ${padTop + innerH} L ${first.x.toFixed(
      2
    )} ${padTop + innerH} Z`;

    const tickEvery = Math.max(1, Math.ceil(data.length / 5));
    const xt = data
      .map((d, i) => ({ x: points[i]!.x, label: d.label, i }))
      .filter((t) => t.i === 0 || t.i === data.length - 1 || t.i % tickEvery === 0)
      .map(({ x, label }) => ({ x, label }));

    return {
      areaPath: ap,
      linePath: lp,
      dots: points,
      maxTick: maxVal.toFixed(maxVal < 10 ? 1 : 0),
      xTicks: xt,
    };
  }, [data, width, height]);

  const selectAtX = (locationX: number) => {
    if (dots.length === 0) return;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < dots.length; i++) {
      const d = Math.abs(dots[i]!.x - locationX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setSelected(best);
  };

  const sel = selected !== null ? dots[selected] : undefined;

  return (
    <View
      style={[styles.wrap, { height }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => selectAtX(e.nativeEvent.locationX)}
      onResponderMove={(e) => selectAtX(e.nativeEvent.locationX)}
    >
      {width > 0 && data.length > 0 ? (
        <>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.accent} stopOpacity="0.25" />
                <Stop offset="1" stopColor={colors.accent} stopOpacity="0.02" />
              </LinearGradient>
            </Defs>
            <G>
              {/* Grid baseline */}
              <Line
                x1="0"
                y1={height - 26}
                x2={width}
                y2={height - 26}
                stroke={colors.divider}
                strokeWidth={1}
              />
              <Path d={areaPath} fill="url(#areaGrad)" />
              <Path
                d={linePath}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* Selected point: vertical guide + highlighted dot */}
              {sel ? (
                <>
                  <Line
                    x1={sel.x}
                    y1={14}
                    x2={sel.x}
                    y2={height - 26}
                    stroke={colors.inkSoft}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <Circle
                    cx={sel.x}
                    cy={sel.y}
                    r={5}
                    fill={colors.accent}
                    stroke={colors.surface}
                    strokeWidth={2}
                  />
                </>
              ) : (
                (() => {
                  const peak = dots.reduce(
                    (acc, p) => (p.value > acc.value ? p : acc),
                    dots[0]!
                  );
                  return <Circle cx={peak.x} cy={peak.y} r={3.5} fill={colors.accent} />;
                })()
              )}
            </G>
          </Svg>
          {/* Y peak label, replaced by the exact readout while inspecting */}
          <View style={[styles.peakLabel, { left: space[2] }]}>
            {sel ? (
              <Text variant="numberS">
                {sel.label} · {formatExact(sel.value)}
                {yLabelSuffix}
              </Text>
            ) : (
              <Text variant="numberS">
                {maxTick}
                {yLabelSuffix}
              </Text>
            )}
          </View>
          {/* X ticks */}
          <View style={styles.xRow}>
            {xTicks.map((t, i) => (
              <View key={i} style={[styles.xTick, { left: t.x - 20, width: 40 }]}>
                <Text variant="meta" soft align="center">
                  {t.label}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    position: 'relative',
  },
  peakLabel: {
    position: 'absolute',
    top: 0,
  },
  xRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  xTick: {
    position: 'absolute',
    alignItems: 'center',
  },
});
