import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../db/DbContext';
import {
  getUserPlaces, getPlaceById, getUserPoiVisitStats, getUnnamedClusters,
  createUserPlace, updateUserPlace, deleteUserPlace, type UserPlaceInput,
} from '../db/places';
import { suggestHomeWork } from '../stats/homeWorkDetection';

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

export function useHomeWorkSuggestion() {
  const db = useDb();
  return useQuery({ queryKey: ['homeWorkSuggestion'], queryFn: () => suggestHomeWork(db) });
}

function useInvalidatePlaces() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['userPlaces'] });
    qc.invalidateQueries({ queryKey: ['userPlaceVisits'] });
    qc.invalidateQueries({ queryKey: ['unnamedClusters'] });
    qc.invalidateQueries({ queryKey: ['homeWorkSuggestion'] });
    qc.invalidateQueries({ queryKey: ['trips'] });
    qc.invalidateQueries({ queryKey: ['trip'] });
  };
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
