import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../db/DbContext';
import {
  getUserPlaces, getPlaceById, getUserPoiVisitStats, getUnnamedClusters,
  createUserPlace, updateUserPlace, deleteUserPlace, dismissSuggestion, type UserPlaceInput,
} from '../db/places';
import { suggestHome } from '../stats/homeDetection';
import { nearestUserPoi } from '../lib/poiResolve';
import type { Place } from '../types';

export function useUserPlaces() {
  const db = useDb();
  return useQuery({ queryKey: ['userPlaces'], queryFn: () => getUserPlaces(db) });
}

export function useUserPlace(id: number | null) {
  const db = useDb();
  return useQuery({
    queryKey: ['userPlace', id],
    queryFn: () => (id !== null ? getPlaceById(db, id) : null),
    enabled: id !== null,
  });
}

export function useUserPoiVisits(enabled = true) {
  const db = useDb();
  return useQuery({
    queryKey: ['userPlaceVisits'],
    queryFn: async () => {
      const pois = await getUserPlaces(db);
      const entries = await Promise.all(
        pois.map(async (p) => [p.id, await getUserPoiVisitStats(db, p)] as const)
      );
      return new Map(entries);
    },
    enabled,
  });
}

export function useUnnamedClusters(limit = 12) {
  const db = useDb();
  return useQuery({ queryKey: ['unnamedClusters', limit], queryFn: () => getUnnamedClusters(db, limit) });
}

export function useHomeSuggestion() {
  const db = useDb();
  return useQuery({ queryKey: ['homeSuggestion'], queryFn: () => suggestHome(db) });
}

function useInvalidatePlaces() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ['userPlaces'] });
    // Also the single-place query the editor reads (['userPlace', id]); without
    // this, reopening a just-edited place serves the stale pre-edit category
    // from cache until an app restart.
    qc.invalidateQueries({ queryKey: ['userPlace'] });
    qc.invalidateQueries({ queryKey: ['userPlaceVisits'] });
    qc.invalidateQueries({ queryKey: ['unnamedClusters'] });
    qc.invalidateQueries({ queryKey: ['homeSuggestion'] });
    qc.invalidateQueries({ queryKey: ['trips'] });
    qc.invalidateQueries({ queryKey: ['trip'] });
  }, [qc]);
}

export function useCreateUserPlace() {
  const db = useDb();
  const invalidate = useInvalidatePlaces();
  return useMutation({
    mutationFn: (input: UserPlaceInput) => createUserPlace(db, input),
    onSuccess: invalidate,
  });
}

export function useUpdateUserPlace() {
  const db = useDb();
  const invalidate = useInvalidatePlaces();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UserPlaceInput }) => updateUserPlace(db, id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteUserPlace() {
  const db = useDb();
  const invalidate = useInvalidatePlaces();
  return useMutation({
    mutationFn: (id: number) => deleteUserPlace(db, id),
    onSuccess: invalidate,
  });
}

export function useDismissSuggestion() {
  const db = useDb();
  const invalidate = useInvalidatePlaces();
  return useMutation({
    mutationFn: (id: number) => dismissSuggestion(db, id),
    onSuccess: invalidate,
  });
}

/** Resolve the user POI (if any) covering a trip's start and end endpoints. */
export function useTripEndpointPois(
  start: Place | null | undefined,
  end: Place | null | undefined
): { startPoi: Place | null; endPoi: Place | null } {
  const places = useUserPlaces();
  const list = places.data ?? [];
  return {
    startPoi: start ? nearestUserPoi(start.latitude, start.longitude, list) : null,
    endPoi: end ? nearestUserPoi(end.latitude, end.longitude, list) : null,
  };
}
