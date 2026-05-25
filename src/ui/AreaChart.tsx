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

export function AreaChart({ data, height = 160, yLabelSuffix = '' }: Props) {
  const [width, setWidth] = useState(0);

  const { areaPath, linePath, dots, maxValue, minTick, maxTick, xTicks } = useMemo(() => {
    if (data.length === 0 || width === 0) {
      return {
        areaPath: '',
        linePath: '',
        dots: [] as { x: number; y: number; value: number }[],
        maxValue: 0,
        minTick: '',
        maxTick: '',
        xTicks: [] as { x: number; label: string }[],
      };
    }
    const padLeft = 8;
    const padRight = 8;
    const padTop = 18;
    const padBottom = 26;
    const innerW = Math.max(1, width - padLeft - padRight);
    const innerH = Math.max(1, height - padTop - padBottom);

    const maxVal = Math.max(1, ...data.map((d) => d.value));
    const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

    const points = data.map((d, i) => {
      const x = padLeft + (data.length > 1 ? i * stepX : innerW / 2);
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
      maxValue: maxVal,
      minTick: '0',
      maxTick: maxVal.toFixed(maxVal < 10 ? 1 : 0),
      xTicks: xt,
    };
  }, [data, width, height]);

  return (
    <View
      style={[styles.wrap, { height }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
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
              {/* Max dot */}
              {dots.length > 0 ? (
                <>
                  {(() => {
                    const peak = dots.reduce(
                      (acc, p) => (p.value > acc.value ? p : acc),
                      dots[0]!
                    );
                    return (
                      <Circle cx={peak.x} cy={peak.y} r={3.5} fill={colors.accent} />
                    );
                  })()}
                </>
              ) : null}
            </G>
          </Svg>
          {/* Y peak label */}
          <View style={[styles.peakLabel, { left: space[2] }]}>
            <Text variant="numberS">
              {maxTick}
              {yLabelSuffix}
            </Text>
          </View>
          {/* X ticks */}
          <View style={styles.xRow}>
            {xTicks.map((t, i) => (
              <View
                key={i}
                style={[
                  styles.xTick,
                  { left: t.x - 20, width: 40 },
                ]}
              >
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
