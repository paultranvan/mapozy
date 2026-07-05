import { t, setCurrentLocale, resolveLocale, normalizeLanguagePref } from '../index';
import { en } from '../en';
import { fr } from '../fr';

afterEach(() => setCurrentLocale('en'));

it('translates per current locale with en fallback', () => {
  setCurrentLocale('en');
  expect(t('common.cancel')).toBe('Cancel');
  setCurrentLocale('fr');
  expect(t('common.cancel')).toBe('Annuler');
});

it('interpolates {param} placeholders', () => {
  setCurrentLocale('fr');
  expect(t('settings.tripsStored', { count: 42 })).toBe('42 trajets enregistrés');
});

it('normalizes stored language preference', () => {
  expect(normalizeLanguagePref(null)).toBe('system');
  expect(normalizeLanguagePref('garbage')).toBe('system');
  expect(normalizeLanguagePref('fr')).toBe('fr');
  expect(resolveLocale('en')).toBe('en');
});

it('fr catalog covers exactly the en keys with no empty values', () => {
  const enKeys = Object.keys(en).sort();
  const frKeys = Object.keys(fr).sort();
  expect(frKeys).toEqual(enKeys);
  for (const [k, v] of Object.entries(fr)) {
    expect(v.length).toBeGreaterThan(0);
    // A {param} used in en must survive in fr (same interpolation contract).
    const params = (en[k as keyof typeof en].match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    const frParams = (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    expect(frParams).toEqual(params);
  }
});
