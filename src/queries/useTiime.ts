import { createContext, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '@/db/DbContext';
import { getSetting, setSetting, SETTING_KEYS } from '@/db/settings';
import { isConnected, clearStoredToken } from '@/connectors/tiime/auth';
import { createTiimeClient } from '@/connectors/tiime/client';
import {
  listCandidates,
  sendCandidate,
  type TiimeCandidate,
  type SendOptions,
} from '@/connectors/tiime/travels';
import { ensurePlaceAddress } from '@/pipeline/geocoding';
import type { StructuredAddress } from '@/db/places';

type RefreshFn = () => Promise<string | null>;
const RefreshCtx = createContext<RefreshFn>(async () => null);
export const TiimeRefresherProvider = RefreshCtx.Provider;
export const useTiimeRefresher = () => useContext(RefreshCtx);

export function useTiimeConnection() {
  const q = useQuery({ queryKey: ['tiime', 'connected'], queryFn: () => isConnected() });
  return { connected: q.data ?? false, refetch: q.refetch };
}

export function useTiimeCandidates() {
  const db = useDb();
  return useQuery({
    queryKey: ['tiime', 'candidates'],
    queryFn: () => listCandidates(db),
  });
}

export function useTiimeConfig() {
  const db = useDb();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['tiime', 'config'],
    queryFn: async () => ({
      companyId: toNum(await getSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_ID)),
      vehicleId: toNum(await getSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_ID)),
    }),
  });
  return {
    companyId: q.data?.companyId ?? null,
    vehicleId: q.data?.vehicleId ?? null,
    setCompanyId: async (id: number) => {
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_ID, String(id));
      qc.invalidateQueries({ queryKey: ['tiime', 'config'] });
    },
    setVehicleId: async (id: number) => {
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_ID, String(id));
      qc.invalidateQueries({ queryKey: ['tiime', 'config'] });
    },
  };
}

function toNum(v: string | null): number | null {
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const EMPTY_ADDR: StructuredAddress = {
  street: null,
  houseNumber: null,
  postalCode: null,
  city: null,
  country: null,
};

export function useSendToTiime() {
  const db = useDb();
  const qc = useQueryClient();
  const refresh = useTiimeRefresher();
  const client = useMemo(() => createTiimeClient({ refresh }), [refresh]);

  return useMutation({
    mutationFn: async (args: {
      candidate: TiimeCandidate;
      companyId: number;
      vehicleId: number;
      roundTrip?: boolean;
      overrides?: Partial<Pick<SendOptions, 'departure' | 'arrival' | 'arrivalCompanyName'>>;
    }) => {
      const { candidate, companyId, vehicleId } = args;
      const departure =
        args.overrides?.departure ??
        (candidate.departurePlaceId != null
          ? (await ensurePlaceAddress(db, candidate.departurePlaceId)) ?? EMPTY_ADDR
          : EMPTY_ADDR);
      const arrival =
        args.overrides?.arrival ??
        (candidate.arrivalPlaceId != null
          ? (await ensurePlaceAddress(db, candidate.arrivalPlaceId)) ?? EMPTY_ADDR
          : EMPTY_ADDR);
      return sendCandidate(db, client, candidate, {
        companyId,
        vehicleId,
        roundTrip: args.roundTrip ?? false,
        arrivalCompanyName: args.overrides?.arrivalCompanyName ?? candidate.arrivalPlaceName,
        departure,
        arrival,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tiime', 'candidates'] });
    },
  });
}

export async function disconnectTiime(): Promise<void> {
  await clearStoredToken();
}
