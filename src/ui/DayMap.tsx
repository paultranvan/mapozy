import { useMemo } from 'react';
import { View, StyleSheet, Text, useWindowDimensions } from 'react-native';
import MapLibreGL, {
  MapView,
  ShapeSource,
  LineLayer,
  PointAnnotation,
  Camera,
} from '@maplibre/maplibre-react-native';
import { colors as themeColors, MODE_COLORS } from '../theme/tokens';
import { effectiveMode } from '../pipeline/effectiveMode';
import type { Trip } from '../types';

MapLibreGL.setAccessToken(null);

// Shared OSM raster style (same source as TripMap).
const OSM_STYLE = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm-raster' }],
};

// Leave room for the bottom sheet (≈ 42% of the screen) so the day's traces
// sit in the visible upper portion of the map.
const PAD = { left: 36, right: 36, top: 70, bottom: 360 };

function sectionCoords(geojson: string): Array<[number, number]> {
  try {
    const g = JSON.parse(geojson);
    return Array.isArray(g.coordinates) ? g.coordinates : [];
  } catch {
    return [];
  }
}

/**
 * Renders every trip of a day on one map: each section as a mode-coloured
 * line, with a dot at each trip's start and a flag at the day's last point.
 * Camera fits all traces, padded so they clear the bottom sheet.
 */
export function DayMap({
  trips,
  selectedTripId = null,
}: {
  trips: Trip[];
  selectedTripId?: number | null;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const dim = selectedTripId != null;

  const { lines, starts, lastPoint, bounds } = useMemo(() => {
    const lines: Array<{ id: string; tripId: number; coords: Array<[number, number]>; color: string }> = [];
    const starts: Array<{ id: string; tripId: number; coord: [number, number]; label: string }> = [];
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

    trips.forEach((t, tripIndex) => {
      const tripId = t.id ?? -1;
      let tripFirst: [number, number] | null = null;
      // Per-section lines (coloured by mode) when sections are loaded.
      for (let i = 0; i < t.sections.length; i++) {
        const s = t.sections[i]!;
        const coords = sectionCoords(s.geojson);
        if (coords.length < 2) continue;
        lines.push({ id: `t${tripId}-s${i}`, tripId, coords, color: MODE_COLORS[effectiveMode(s)] });
        if (!tripFirst) tripFirst = coords[0]!;
        lastPoint = coords[coords.length - 1]!;
        extend(coords);
      }
      // Fallback: a trip without hydrated sections still has its full-trip
      // LineString — draw it in the dominant-mode colour so the map is never blank.
      if (!tripFirst) {
        const coords = sectionCoords(t.geojson);
        if (coords.length >= 2) {
          lines.push({ id: `t${tripId}-full`, tripId, coords, color: MODE_COLORS[t.dominantMode] });
          tripFirst = coords[0]!;
          lastPoint = coords[coords.length - 1]!;
          extend(coords);
        }
      }
      if (tripFirst) {
        starts.push({
          id: `t${tripId}-start`,
          tripId,
          coord: tripFirst,
          label: String(tripIndex + 1),
        });
      }
    });

    const hasData = Number.isFinite(minLon);
    return {
      lines,
      starts,
      lastPoint,
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

  if (!bounds) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text>No GPS traces for this day</Text>
      </View>
    );
  }

  // When a trip is selected, draw the dimmed lines first and the selected
  // trip's lines last so the highlight always sits on top.
  const orderedLines = dim
    ? [...lines].sort(
        (a, b) =>
          (a.tripId === selectedTripId ? 1 : 0) - (b.tripId === selectedTripId ? 1 : 0)
      )
    : lines;

  return (
    <MapView style={styles.container} mapStyle={OSM_STYLE as unknown as string}>
      <Camera bounds={bounds} animationMode="moveTo" animationDuration={0} />
      {orderedLines.map((l) => {
        const isSel = l.tripId === selectedTripId;
        return (
          <ShapeSource
            key={l.id}
            id={l.id}
            shape={{
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: l.coords },
              properties: {},
            }}
          >
            <LineLayer
              id={`line-${l.id}`}
              style={{
                lineColor: l.color,
                lineWidth: dim && isSel ? 6 : 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: dim ? (isSel ? 1 : 0.15) : 0.9,
              }}
            />
          </ShapeSource>
        );
      })}
      {starts.map((s) => (
        // Anchor at the pin tip (bottom-centre) so the numbered head floats
        // ABOVE the start point — lines converge at the tip, clear of the digit.
        <PointAnnotation key={s.id} id={s.id} coordinate={s.coord} anchor={{ x: 0.5, y: 1 }}>
          <View
            style={[
              styles.pin,
              dim && s.tripId !== selectedTripId && styles.markerDim,
            ]}
          >
            <View style={styles.numBadge}>
              <Text style={styles.numText}>{s.label}</Text>
            </View>
            <View style={styles.pinTail} />
          </View>
        </PointAnnotation>
      ))}
      {lastPoint ? (
        <PointAnnotation id="day-end" coordinate={lastPoint} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.endDot} />
        </PointAnnotation>
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  pin: { alignItems: 'center' },
  pinTail: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: themeColors.deep,
  },
  numBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 4,
    borderRadius: 11,
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
  markerDim: { opacity: 0.3 },
  endDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: themeColors.surface,
    backgroundColor: themeColors.end,
  },
});
