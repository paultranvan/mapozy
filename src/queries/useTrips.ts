import { useQuery } from '@tanstack/react-query';
import { useDb } from '../db/DbContext';
import {
  listTrips,
  getTripById,
  countTrips,
  getTripsInRangeWithSections,
} from '../db/trips';
import { getAllPlaces, getPlaceById } from '../db/places';
import { periodKpi, dailyDistances } from '../stats/periodStats';
import { modeBreakdown } from '../stats/modeBreakdown';
import { records } from '../stats/records';
import type { PeriodKey } from '../lib/time';
import { periodToRange, rangeForDayKey } from '../lib/time';

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

export function usePeriodKpi(period: PeriodKey) {
  const db = useDb();
  const [start, end] = periodToRange(period);
  return useQuery({
    queryKey: ['stats', 'kpi', period],
    queryFn: () => periodKpi(db, start, end),
  });
}

export function useDailyDistances(period: PeriodKey) {
  const db = useDb();
  const [start, end] = periodToRange(period);
  return useQuery({
    queryKey: ['stats', 'daily', period],
    queryFn: () => dailyDistances(db, start, end),
  });
}

export function useModeBreakdown(period: PeriodKey) {
  const db = useDb();
  const [start, end] = periodToRange(period);
  return useQuery({
    queryKey: ['stats', 'modeBreakdown', period],
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
