/**
 * Derive display labels for a trip endpoint.
 *
 * `full`  — primary locator + city, house number stripped ("Rue de la République, Paris").
 *           Used where the city still carries value (origin caption, timeline stops).
 * `short` — primary locator only ("Rue de la République"). Used as a headline where the
 *           city is redundant with the map and the origin line.
 *
 * Saved places (home/work) collapse both forms to the saved name. A place that hasn't
 * been geocoded yet falls back to coordinates.
 */

export interface PlaceLabels {
  full: string;
  short: string;
}

type PlaceLike =
  | {
      label: string | null;
      displayName: string | null;
      latitude: number;
      longitude: number;
    }
  | null
  | undefined;

// Leading street numbers, optionally a letter or range: "12", "12b", "12–14".
const LEADING_HOUSE_NUMBER = /^\d+[a-z]?(?:[–-]\d+[a-z]?)?\s+/i;

function stripHouseNumber(segment: string): string {
  return segment.replace(LEADING_HOUSE_NUMBER, '').trim() || segment;
}

export function placeLabels(place: PlaceLike, fallback: string): PlaceLabels {
  if (!place) return { full: fallback, short: fallback };
  if (place.label === 'home') return { full: 'Home', short: 'Home' };
  if (place.label === 'work') return { full: 'Work', short: 'Work' };

  if (place.displayName) {
    const segments = place.displayName
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const [first, second] = segments;
    if (first) {
      const street = stripHouseNumber(first);
      const city = second ?? '';
      return { full: city ? `${street}, ${city}` : street, short: street };
    }
  }

  const coords = `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
  return { full: coords, short: coords };
}
