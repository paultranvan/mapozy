import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useDb } from '../db/DbContext';
import {
  listTrips,
  getTripById,
  countTrips,
  getTripsInRangeWithSections,
  getTripStartTimesInRange,
} from '../db/trips';
import { getAllPlaces, getPlaceById } from '../db/places';
import {
  periodKpi,
  dailyDistances,
  hourlyDistances,
  aggregateDailyBuckets,
  bucketGranularityFor,
} from '../stats/periodStats';
import { modeBreakdown } from '../stats/modeBreakdown';
import { records } from '../stats/records';
import type { PeriodKey } from '../lib/time';
import type { Mode } from '../types';
import { navigablePeriodRange, rangeForDayKey, dayKey } from '../lib/time';

export function useTripsList(limit = 200) {
  const db = useDb();
  return useQuery({
    queryKey: ['trips', 'list', limit],
    queryFn: () => listTrips(db, limit, 0),
  });
}

// Trips that started on a given `YYYY-MM-DD` (matches the Trips list's
// group-by-start-day), oldest-first for chronological reading on the day map.
export function useDayTrips(dayKey: string) {
  const db = useDb();
  return useQuery({
    queryKey: ['trips', 'day', dayKey],
    queryFn: () => {
      const [start, end] = rangeForDayKey(dayKey);
      return getTripsInRangeWithSections(db, start, end);
    },
    enabled: !!dayKey,
    // Keep the previous day's data on screen while the next loads, so switching
    // days updates the map in place instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
}

// Set of `YYYY-MM-DD` keys that have at least one trip in [startMs, endMs] —
// drives the week strip's "has trips" dots.
export function useTripDaysWithTrips(startMs: number, endMs: number) {
  const db = useDb();
  return useQuery({
    queryKey: ['trips', 'days', startMs, endMs],
    queryFn: async () => {
      const times = await getTripStartTimesInRange(db, startMs, endMs);
      return new Set(times.map((t) => dayKey(t)));
    },
    placeholderData: keepPreviousData,
  });
}

export function useTrip(id: number) {
  const db = useDb();
  return useQuery({
    queryKey: ['trip', id],
    queryFn: () => getTripById(db, id),
    enabled: !!id,
  });
}

export function useTripsCount() {
  const db = useDb();
  return useQuery({
    queryKey: ['trips', 'count'],
    queryFn: () => countTrips(db),
  });
}

export function usePlaces() {
  const db = useDb();
  return useQuery({
    queryKey: ['places'],
    queryFn: () => getAllPlaces(db),
  });
}

export function usePlace(id: number | null) {
  const db = useDb();
  return useQuery({
    queryKey: ['place', id],
    queryFn: () => (id !== null ? getPlaceById(db, id) : null),
    enabled: id !== null,
  });
}

// `mode` filters the totals down to sections of that effective mode
// (user_mode ?? mode) — null means all modes.
export function usePeriodKpi(period: PeriodKey, offset = 0, mode: Mode | null = null) {
  const db = useDb();
  const { start, end } = navigablePeriodRange(period, offset);
  return useQuery({
    queryKey: ['stats', 'kpi', period, start, end, mode],
    queryFn: () => periodKpi(db, start, end, mode),
    // Keep the previous total on screen while a mode-filter toggle refetches,
    // so the hero card doesn't flash empty.
    placeholderData: keepPreviousData,
  });
}

export function useDailyDistances(period: PeriodKey, offset = 0, mode: Mode | null = null) {
  const db = useDb();
  const { start, end } = navigablePeriodRange(period, offset);
  const granularity = bucketGranularityFor(period);
  return useQuery({
    queryKey: ['stats', 'daily', period, start, end, mode],
    queryFn: async () =>
      granularity === 'hour'
        ? hourlyDistances(db, start, end, mode)
        : aggregateDailyBuckets(await dailyDistances(db, start, end, mode), granularity),
    // Same as above: no chart flash while toggling the mode filter.
    placeholderData: keepPreviousData,
  });
}

export function useModeBreakdown(period: PeriodKey, offset = 0) {
  const db = useDb();
  const { start, end } = navigablePeriodRange(period, offset);
  return useQuery({
    queryKey: ['stats', 'modeBreakdown', period, start, end],
    queryFn: () => modeBreakdown(db, start, end),
  });
}

export function useRecords() {
  const db = useDb();
  return useQuery({
    queryKey: ['stats', 'records'],
    queryFn: () => records(db),
  });
}
