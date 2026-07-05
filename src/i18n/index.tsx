/**
 * Minimal i18n for Mapozy — two locales (en/fr), typed flat catalogs, no
 * runtime dependency beyond expo-localization for the system locale.
 *
 * - React code: `const { t } = useI18n()` — re-renders on language change.
 * - Non-React code (formatters, alerts, native notification text): import
 *   the module-level `t`; it reads the current locale at call time.
 *
 * The user preference ('system' | 'en' | 'fr') is persisted in the settings
 * table (SETTING_KEYS.LANGUAGE) and resolved to a concrete locale here.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getLocales } from 'expo-localization';
import { en, type TranslationKey } from './en';
import { fr } from './fr';
import { setSetting, SETTING_KEYS } from '@/db/settings';
import type { Db } from '@/db/client';

export type Locale = 'en' | 'fr';
export type LanguagePref = 'system' | Locale;

const catalogs: Record<Locale, Record<TranslationKey, string>> = { en, fr };

export function systemLocale(): Locale {
  return getLocales()[0]?.languageCode === 'fr' ? 'fr' : 'en';
}

export function resolveLocale(pref: LanguagePref): Locale {
  return pref === 'system' ? systemLocale() : pref;
}

export function normalizeLanguagePref(raw: string | null): LanguagePref {
  return raw === 'en' || raw === 'fr' ? raw : 'system';
}

let currentLocale: Locale = systemLocale();

export function setCurrentLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getCurrentLocale(): Locale {
  return currentLocale;
}

export type TParams = Record<string, string | number>;

export function t(key: TranslationKey, params?: TParams): string {
  let s = catalogs[currentLocale][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export type { TranslationKey };

interface I18nContextValue {
  locale: Locale;
  language: LanguagePref;
  t: typeof t;
  setLanguage: (pref: LanguagePref) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  db,
  initialLanguage,
  children,
}: {
  db: Db;
  initialLanguage: LanguagePref;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<LanguagePref>(initialLanguage);
  const locale = resolveLocale(language);
  // Keep the module-level locale in sync for non-React callers. Assigning
  // during render (not in an effect) so formatters called in the same render
  // pass already see the new locale.
  currentLocale = locale;

  const setLanguage = useCallback(
    (pref: LanguagePref) => {
      setLanguageState(pref);
      setCurrentLocale(resolveLocale(pref));
      void setSetting(db, SETTING_KEYS.LANGUAGE, pref);
    },
    [db]
  );

  const value = useMemo<I18nContextValue>(
    // `t` is included so consumers re-render with fresh strings: the context
    // value identity changes whenever locale does.
    () => ({ locale, language, t, setLanguage }),
    [locale, language, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
