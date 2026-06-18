import { circlePolygon } from '../circle';
import { haversineMeters } from '../distance';

describe('circlePolygon', () => {
  it('builds a closed ring of steps+1 vertices', () => {
    const f = circlePolygon(4.85, 45.75, 200, 64);
    const ring = f.geometry.coordinates[0]!;
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
  });

  it('places every vertex approximately radiusM from the center', () => {
    const f = circlePolygon(4.85, 45.75, 200, 64);
    for (const [lon, lat] of f.geometry.coordinates[0]!) {
      const d = haversineMeters(45.75, 4.85, lat!, lon!);
      expect(Math.abs(d - 200)).toBeLessThan(10); // within 10 m of 200 m
    }
  });

  it('scales with radius', () => {
    const small = circlePolygon(4.85, 45.75, 50, 32).geometry.coordinates[0]!;
    const dSmall = haversineMeters(45.75, 4.85, small[0]![1]!, small[0]![0]!);
    expect(Math.abs(dSmall - 50)).toBeLessThan(5);
  });
});
