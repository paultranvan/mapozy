/**
 * Localized date-name tables, indexed by Date.getDay() (0=Sun) and
 * Date.getMonth() (0=Jan). Kept out of the string catalogs — arrays are the
 * natural shape here.
 */

import { getCurrentLocale, type Locale } from './index';

const WEEKDAYS_TABLE: Record<Locale, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
};

const WEEKDAYS_SHORT_TABLE: Record<Locale, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fr: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
};

const MONTHS_SHORT_TABLE: Record<Locale, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'],
};

export function weekdays(): string[] {
  return WEEKDAYS_TABLE[getCurrentLocale()];
}

export function weekdaysShort(): string[] {
  return WEEKDAYS_SHORT_TABLE[getCurrentLocale()];
}

export function monthsShort(): string[] {
  return MONTHS_SHORT_TABLE[getCurrentLocale()];
}
