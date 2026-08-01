import { placeLabels } from '../placeLabel';
import type { Place } from '../../types';

const userPoi: Place = {
  id: 5, kind: 'user', name: 'Basic-Fit', category: 'sport',
  latitude: 45.75, longitude: 4.85, radiusM: 100,
  displayName: null, street: null, houseNumber: null, postalCode: null, city: null, country: null,
  visitCount: 0, firstSeenMs: 0, lastSeenMs: 0,
};

describe('placeLabels', () => {
  it('shows the user POI name (not a generic Home) when resolved', () => {
    expect(placeLabels(null, 'Start', userPoi)).toEqual({ full: 'Basic-Fit', short: 'Basic-Fit' });
  });
  it('falls back to a geocoded address when no POI resolves', () => {
    const auto = { displayName: '12 Rue de la République, Paris', latitude: 48.8, longitude: 2.3 };
    expect(placeLabels(auto, 'Start', null)).toEqual({
      full: 'Rue de la République, Paris', short: 'Rue de la République',
    });
  });
  it('falls back to coords when nothing is available', () => {
    expect(placeLabels(null, 'Start', null)).toEqual({ full: 'Start', short: 'Start' });
  });
});
