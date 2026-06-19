import { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapLibreGL, {
  MapView,
  ShapeSource,
  LineLayer,
  CircleLayer,
  MarkerView,
  Camera,
} from '@maplibre/maplibre-react-native';
import { colors as themeColors, MODE_COLORS } from '../theme/tokens';
import { effectiveMode } from '../pipeline/effectiveMode';
import { resolveCategory } from './placeCategories';
import { useCategories } from '@/queries/useCategories';
import { OSM_STYLE } from './mapStyle';
import type { Trip } from '../types';

MapLibreGL.setAccessToken(null);

// Numbered markers are MarkerView overlays (React views), so there's no glyph
// font dependency and no PointAnnotation flicker. Lines are a single
// data-driven source so switching days swaps source data (a smooth diff).

// bottom clears the fixed ~46%-height detail panel; top clears the back button.
const PAD = { left: 36, right: 36, top: 70, bottom: 400 };
// MarkerView anchors: trip pins float just above their point; place pins
// higher so they clear a coincident numbered pin.
const TRIP_ANCHOR = { x: 0.5, y: 1.35 };
const PLACE_ANCHOR = { x: 0.5, y: 1.7 };
// Day's last-point marker — fully static.
const END_CIRCLE = {
  circleColor: themeColors.end,
  circleRadius: 6,
  circleStrokeColor: themeColors.surface,
  circleStrokeWidth: 3,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FC = any;

function sectionCoords(geojson: string): Array<[number, number]> {
  try {
    const g = JSON.parse(geojson);
    return Array.isArray(g.coordinates) ? g.coordinates : [];
  } catch {
    return [];
  }
}

export function DayMap({
  trips,
  selectedTripId = null,
  placeMarkers = [],
}: {
  trips: Trip[];
  selectedTripId?: number | null;
  placeMarkers?: { kind: string; coord: [number, number]; name: string | null }[];
}) {
  const dim = selectedTripId != null;
  const categories = useCategories();

  const { lineFC, endFC, starts, bounds } = useMemo(() => {
    const lineFeatures: FC[] = [];
    const starts: Array<{ tripId: number; coord: [number, number]; label: string }> = [];
    let lastPoint: [number, number] | null = null;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

    const extend = (coords: Array<[number, number]>) => {
      for (const [lon, lat] of coords) {
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
      }
    };
    const lineFeat = (coords: Array<[number, number]>, tripId: number, color: string) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { tripId, color },
    });

    trips.forEach((t, tripIndex) => {
      const tripId = t.id ?? -1;
      let tripFirst: [number, number] | null = null;
      for (const s of t.sections) {
        const coords = sectionCoords(s.geojson);
        if (coords.length < 2) continue;
        lineFeatures.push(lineFeat(coords, tripId, MODE_COLORS[effectiveMode(s)]));
        if (!tripFirst) tripFirst = coords[0]!;
        lastPoint = coords[coords.length - 1]!;
        extend(coords);
      }
      if (!tripFirst) {
        const coords = sectionCoords(t.geojson);
        if (coords.length >= 2) {
          lineFeatures.push(lineFeat(coords, tripId, MODE_COLORS[t.dominantMode]));
          tripFirst = coords[0]!;
          lastPoint = coords[coords.length - 1]!;
          extend(coords);
        }
      }
      if (tripFirst) starts.push({ tripId, coord: tripFirst, label: String(tripIndex + 1) });
    });

    const hasData = Number.isFinite(minLon);
    return {
      lineFC: { type: 'FeatureCollection', features: lineFeatures } as FC,
      endFC: {
        type: 'FeatureCollection',
        features: lastPoint
          ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: lastPoint }, properties: {} }]
          : [],
      } as FC,
      starts,
      bounds: hasData
        ? {
            sw: [minLon, minLat] as [number, number],
            ne: [maxLon, maxLat] as [number, number],
            paddingLeft: PAD.left,
            paddingRight: PAD.right,
            paddingTop: PAD.top,
            paddingBottom: PAD.bottom,
          }
        : null,
    };
  }, [trips]);

  const lineStyle = useMemo(() => {
    const match = ['==', ['get', 'tripId'], selectedTripId];
    return {
      lineColor: ['get', 'color'],
      lineWidth: dim ? ['case', match, 6, 5] : 5,
      lineOpacity: dim ? ['case', match, 1, 0.12] : 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }, [selectedTripId, dim]);

  if (!bounds) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text>No GPS traces for this day</Text>
      </View>
    );
  }

  return (
    <MapView style={styles.container} mapStyle={OSM_STYLE as unknown as string}>
      <Camera bounds={bounds} animationMode="easeTo" animationDuration={300} />
      <ShapeSource id="day-lines" shape={lineFC}>
        <LineLayer id="day-lines-l" style={lineStyle} />
      </ShapeSource>
      <ShapeSource id="day-end" shape={endFC}>
        <CircleLayer id="day-end-l" style={END_CIRCLE} />
      </ShapeSource>
      {starts.map((s) => (
        <MarkerView
          key={`${s.tripId}-${s.label}`}
          coordinate={s.coord}
          anchor={TRIP_ANCHOR}
          allowOverlap
        >
          <View
            style={[
              styles.numBadge,
              dim && s.tripId !== selectedTripId && styles.markerDim,
            ]}
          >
            <Text style={styles.numText}>{s.label}</Text>
          </View>
        </MarkerView>
      ))}
      {placeMarkers.map((p, i) => {
        const meta = resolveCategory(p.kind, categories);
        return (
          // Anchored higher (y > 1) so the place pin floats clear above any
          // numbered trip marker sharing the same place.
          <MarkerView
            key={`place-${p.kind}-${i}`}
            coordinate={p.coord}
            anchor={PLACE_ANCHOR}
            allowOverlap
          >
            <View style={[styles.placePin, { backgroundColor: meta.color }]}>
              <MaterialCommunityIcons
                name={meta.icon}
                size={16}
                color={themeColors.surface}
              />
            </View>
          </MarkerView>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  markerDim: { opacity: 0.3 },
  numBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: themeColors.surface,
    backgroundColor: themeColors.deep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: {
    color: themeColors.surface,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  placePin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: themeColors.surface,
    backgroundColor: themeColors.deep,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
