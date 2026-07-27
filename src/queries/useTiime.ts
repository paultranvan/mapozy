import { createContext, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '@/db/DbContext';
import { getSetting, setSetting, SETTING_KEYS } from '@/db/settings';
import { hasStoredToken, clearStoredToken } from '@/connectors/tiime/auth';
import { createTiimeClient } from '@/connectors/tiime/client';
import {
  listCandidates,
  sendCandidate,
  resolveTravelAddresses,
  type TiimeCandidate,
  type SendOptions,
} from '@/connectors/tiime/travels';

type RefreshFn = () => Promise<string | null>;
const RefreshCtx = createContext<RefreshFn>(async () => null);
export const TiimeRefresherProvider = RefreshCtx.Provider;
export const useTiimeRefresher = () => useContext(RefreshCtx);

export function useTiimeConnection() {
  // Presence-only: an expired token still counts as connected — the client
  // refreshes it lazily (validToken / 401 retry). Gating on expiry here would
  // hide every UI surface and the refresh paths would never get to run.
  const q = useQuery({ queryKey: ['tiime', 'connected'], queryFn: () => hasStoredToken() });
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
      companyName: await getSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_NAME),
      vehicleName: await getSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_NAME),
    }),
  });
  return {
    companyId: q.data?.companyId ?? null,
    vehicleId: q.data?.vehicleId ?? null,
    companyName: q.data?.companyName ?? null,
    vehicleName: q.data?.vehicleName ?? null,
    setCompany: async (id: number, name: string) => {
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_ID, String(id));
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_NAME, name);
      qc.invalidateQueries({ queryKey: ['tiime', 'config'] });
    },
    setVehicle: async (id: number, name: string) => {
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_ID, String(id));
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_NAME, name);
      qc.invalidateQueries({ queryKey: ['tiime', 'config'] });
    },
  };
}

function toNum(v: string | null): number | null {
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

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
      let departure = args.overrides?.departure;
      let arrival = args.overrides?.arrival;
      if (!departure || !arrival) {
        const resolved = await resolveTravelAddresses(db, candidate);
        departure = departure ?? resolved.departure;
        arrival = arrival ?? resolved.arrival;
      }
      return sendCandidate(db, client, candidate, {
        companyId,
        vehicleId,
        roundTrip: args.roundTrip ?? false,
        arrivalCompanyName: args.overrides?.arrivalCompanyName ?? candidate.arrivalCompanyName,
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
