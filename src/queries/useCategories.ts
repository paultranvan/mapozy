import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../db/DbContext';
import {
  getCustomCategories, createCustomCategory, updateCustomCategory, deleteCustomCategory,
  type CustomCategoryInput,
} from '../db/customCategories';
import { builtinCategories, customToMeta, type CategoryMeta } from '../ui/placeCategories';

export function useCustomCategories() {
  const db = useDb();
  return useQuery({ queryKey: ['customCategories'], queryFn: () => getCustomCategories(db) });
}

/** Built-in categories followed by the user's custom ones, as CategoryMeta[]. */
export function useCategories(): CategoryMeta[] {
  const custom = useCustomCategories();
  return [...builtinCategories(), ...(custom.data ?? []).map(customToMeta)];
}

export function useCreateCustomCategory() {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomCategoryInput) => createCustomCategory(db, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customCategories'] }),
  });
}

export function useUpdateCustomCategory() {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CustomCategoryInput }) =>
      updateCustomCategory(db, id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customCategories'] });
      qc.invalidateQueries({ queryKey: ['userPlaces'] }); // badges pick up new icon/color
    },
  });
}

export function useDeleteCustomCategory() {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCustomCategory(db, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customCategories'] });
      qc.invalidateQueries({ queryKey: ['userPlaces'] }); // places using it now fall back
    },
  });
}
