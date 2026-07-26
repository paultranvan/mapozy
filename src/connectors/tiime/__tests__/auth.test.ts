jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { decodeJwtExpMs, isTokenExpired } from '../auth';

// Minimal JWT with payload {"exp": 1785084920}
function jwtWithExp(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64');
  return `header.${payload}.sig`;
}

describe('tiime auth token logic', () => {
  it('decodes exp (seconds) into milliseconds', () => {
    expect(decodeJwtExpMs(jwtWithExp(1785084920))).toBe(1785084920000);
  });

  it('returns null for a malformed token', () => {
    expect(decodeJwtExpMs('not-a-jwt')).toBeNull();
  });

  it('treats a token within the skew window as expired', () => {
    const exp = 2_000_000; // seconds
    const expMs = exp * 1000;
    expect(isTokenExpired(jwtWithExp(exp), expMs - 120_000)).toBe(false);
    expect(isTokenExpired(jwtWithExp(exp), expMs - 30_000)).toBe(true); // inside 60s skew
    expect(isTokenExpired(jwtWithExp(exp), expMs + 10_000)).toBe(true);
  });
});
