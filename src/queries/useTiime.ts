import { createContext, useCallback, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '@/db/DbContext';
import { getSetting, setSetting, SETTING_KEYS } from '@/db/settings';
import {
  getStoredToken,
  clearStoredToken,
  decodeJwtExpMs,
  isTokenExpired,
} from '@/connectors/tiime/auth';
import { createTiimeClient, TiimeAuthError } from '@/connectors/tiime/client';
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

export interface TiimeSession {
  /** A token is stored (expired or not). Presence — not validity — decides
   *  whether the connector UI shows at all: an expired session must still
   *  render, otherwise the user has no surface to reconnect from. */
  connected: boolean;
  /** The stored token is expired AND the silent renewal could not produce a
   *  live one. The session is dead: every API call would 401, so callers must
   *  offer sign-in instead of firing requests. */
  expired: boolean;
  /** When the known token dies, for display. Null if the JWT carries no exp. */
  expiresAtMs: number | null;
}

const DEAD: TiimeSession = { connected: false, expired: false, expiresAtMs: null };

/**
 * Session state, evaluated from the JWT's own `exp` rather than discovered by
 * taking a 401 in the face. An expired access token is not necessarily a dead
 * session — Auth0's SSO cookies usually renew it silently — so "expired" here
 * means the renewal was ATTEMPTED and failed. That distinction is what lets
 * the UI ask for a reconnection at the right moment instead of surfacing a raw
 * `Tiime API ... failed: 401` from whatever the user happened to tap.
 */
export function useTiimeSession() {
  const refresh = useTiimeRefresher();
  // Deliberately two queries. Presence is one SecureStore read and gates every
  // Tiime surface in the app, so it must stay instant; validity can block on a
  // 15s offscreen renewal. Folding them into one query would make four screens
  // wait on that renewal before they know whether to show Tiime at all.
  const presence = useQuery({
    queryKey: ['tiime', 'connected'],
    queryFn: () => getStoredToken().then((t) => t !== null),
  });
  const validity = useQuery({
    queryKey: ['tiime', 'session'],
    enabled: presence.data === true,
    queryFn: async (): Promise<TiimeSession> => {
      const token = await getStoredToken();
      if (!token) return DEAD;
      if (!isTokenExpired(token, Date.now())) {
        return { connected: true, expired: false, expiresAtMs: decodeJwtExpMs(token) };
      }
      // Expired: renew NOW, before the user triggers anything. The refresher
      // is single-flight, so a concurrent client-side refresh shares this one.
      const fresh = await refresh();
      if (fresh && !isTokenExpired(fresh, Date.now())) {
        return { connected: true, expired: false, expiresAtMs: decodeJwtExpMs(fresh) };
      }
      return { connected: true, expired: true, expiresAtMs: decodeJwtExpMs(token) };
    },
    // The renewal spins up an offscreen WebView; don't repeat it on every
    // screen mount. Any auth failure invalidates this key explicitly.
    staleTime: 5 * 60_000,
  });
  return {
    connected: presence.data ?? false,
    // False while the renewal is still in flight: "not yet known to be dead"
    // must not read as dead, or the reconnect screen flashes on every start.
    expired: validity.data?.expired ?? false,
    expiresAtMs: validity.data?.expiresAtMs ?? null,
    /** True once validity has actually been evaluated. Gate any "the session
     *  is fine" conclusion on this — `expired` is false before it too. */
    loaded: validity.isSuccess,
    refetch: async () => {
      await presence.refetch();
      await validity.refetch();
    },
  };
}

export function useTiimeConnection() {
  const s = useTiimeSession();
  return { connected: s.connected, expired: s.expired, refetch: s.refetch };
}

/** Re-evaluate the session after an action failed on auth. Call this from any
 *  catch that sees a TiimeAuthError so the reconnect affordance appears
 *  instead of a stringified error the user cannot act on. */
export function useTiimeAuthFailureHandler() {
  const qc = useQueryClient();
  // Stable identity: callers put it in useCallback/useEffect dependency lists.
  return useCallback(
    (e: unknown): boolean => {
      if (!(e instanceof TiimeAuthError)) return false;
      qc.invalidateQueries({ queryKey: ['tiime', 'session'] });
      return true;
    },
    [qc]
  );
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
      companyName: toStr(await getSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_NAME)),
      vehicleName: toStr(await getSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_NAME)),
    }),
  });
  return {
    // True once the initial sqlite read has resolved (success OR — see
    // isSuccess semantics — settled with data). Callers MUST gate any
    // "is setup missing?" decision on this: companyId/vehicleId are also
    // null while the query is still in flight, and treating that as "not
    // set up" is exactly the race that caused spurious API calls on cold
    // start (see settings.tsx ensure-setup effect).
    loaded: q.isSuccess,
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
    // Disconnect must wipe the persisted company/vehicle, not just the auth
    // token — otherwise reconnecting (possibly with a DIFFERENT Tiime
    // account) sees stale ids, tiimeSetupComplete is immediately true, and
    // trips get sent against the old account's company/vehicle.
    // settings.ts has no delete helper, so we write empty strings; toNum('')
    // and toStr('') both normalize back to null on the next read.
    clearConfig: async () => {
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_ID, '');
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_COMPANY_NAME, '');
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_ID, '');
      await setSetting(db, SETTING_KEYS.TIIME_DEFAULT_VEHICLE_NAME, '');
      await qc.invalidateQueries({ queryKey: ['tiime', 'config'] });
    },
  };
}

function toNum(v: string | null): number | null {
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: string | null): string | null {
  return v || null;
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
