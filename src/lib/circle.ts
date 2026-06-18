const LAT_DEG_M = 111_320;

/**
 * A GeoJSON polygon approximating a circle of `radiusM` around (lon, lat),
 * for drawing a radius ring on the map. Equirectangular approximation — accurate
 * to well under a metre for the small radii (≤ 500 m) we use. Coordinates are
 * [longitude, latitude] (MapLibre order). The ring is closed (first === last).
 */
export function circlePolygon(
  lon: number,
  lat: number,
  radiusM: number,
  steps = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const dLat = radiusM / LAT_DEG_M;
  const dLon = radiusM / (LAT_DEG_M * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}
