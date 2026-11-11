jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { isTiimeAppUrl, READ_TOKEN_JS, POLL_TOKEN_JS } from '../webview';

describe('isTiimeAppUrl', () => {
  it('accepts pages of the Tiime SPA origin', () => {
    expect(isTiimeAppUrl('https://apps.tiime.fr')).toBe(true);
    expect(isTiimeAppUrl('https://apps.tiime.fr/')).toBe(true);
    expect(isTiimeAppUrl('https://apps.tiime.fr/signin')).toBe(true);
    expect(isTiimeAppUrl('https://apps.tiime.fr:443/companies/1?x=1#y')).toBe(true);
    expect(isTiimeAppUrl('HTTPS://APPS.TIIME.FR/signin')).toBe(true);
  });

  it('rejects every other origin, including look-alikes', () => {
    for (const url of [
      'http://apps.tiime.fr/signin', // cleartext
      'https://apps.tiime.fr.evil.com/signin', // suffix
      'https://apps.tiime.fr@evil.com/', // userinfo trick
      'https://evil.com/https://apps.tiime.fr/', // path
      'https://evil.com/?u=https://apps.tiime.fr/',
      'https://xapps.tiime.fr/',
      'https://apps.tiime.fr:8443/', // other port = other origin
      'https://auth0.tiime.fr/login', // sibling subdomain: not where the token lives
      'https://tiime.fr/',
      'about:blank',
      'javascript:alert(1)',
      '',
    ]) {
      expect(isTiimeAppUrl(url)).toBe(false);
    }
    expect(isTiimeAppUrl(undefined)).toBe(false);
    expect(isTiimeAppUrl(null)).toBe(false);
  });
});

describe('injected token readers', () => {
  it('bail out before touching storage on a foreign origin', () => {
    for (const js of [READ_TOKEN_JS, POLL_TOKEN_JS]) {
      const guard = js.indexOf("window.location.origin !== 'https://apps.tiime.fr'");
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(js.indexOf('localStorage'));
    }
  });
});
