import * as SecureStore from 'expo-secure-store';

export const TIIME_TOKEN_KEY = 'tiime_access_token';

/** Base64-decode a string in both Node (tests) and Hermes/RN runtimes. */
function base64Decode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') return atob(b64);
  // Node fallback for the Jest environment.
  return Buffer.from(b64, 'base64').toString('binary');
}

export function decodeJwtExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64Decode(parts[1]!)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(
  token: string,
  nowMs: number,
  skewMs = 60_000
): boolean {
  const expMs = decodeJwtExpMs(token);
  if (expMs === null) return true;
  return nowMs >= expMs - skewMs;
}

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TIIME_TOKEN_KEY);
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TIIME_TOKEN_KEY, token);
}

export async function clearStoredToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TIIME_TOKEN_KEY);
}

export async function isConnected(): Promise<boolean> {
  const token = await getStoredToken();
  return token !== null && !isTokenExpired(token, Date.now());
}
