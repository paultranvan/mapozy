import { nearestUserPoi } from '../poiResolve';
import type { Place } from '../../types';

const poi = (over: Partial<Place>): Place => ({
  id: 1, kind: 'user', name: 'P', category: 'home',
  latitude: 45.75, longitude: 4.85, radiusM: 100,
  displayName: null, street: null, houseNumber: null, postalCode: null, city: null, country: null,
  visitCount: 0, firstSeenMs: 0, lastSeenMs: 0, ...over,
});

describe('nearestUserPoi', () => {
  it('returns the POI when the point is inside its radius', () => {
    const p = poi({});
    expect(nearestUserPoi(45.7501, 4.8501, [p])?.id).toBe(1);
  });
  it('returns null when outside every radius', () => {
    expect(nearestUserPoi(45.80, 4.90, [poi({})])).toBeNull();
  });
  it('picks the nearest center when radii overlap', () => {
    const a = poi({ id: 1, latitude: 45.7500, longitude: 4.8500, radiusM: 500 });
    const b = poi({ id: 2, latitude: 45.7505, longitude: 4.8500, radiusM: 500 });
    expect(nearestUserPoi(45.7504, 4.8500, [a, b])?.id).toBe(2);
  });
  it('ignores non-user places', () => {
    expect(nearestUserPoi(45.75, 4.85, [poi({ kind: 'auto' })])).toBeNull();
  });
});
