import { getCurrentLocale } from '@/i18n';
import { monthsShort, weekdays, weekdaysShort } from '@/i18n/dates';

// Locale-aware decimal separator ("12.4" → "12,4" in French).
function fmtNum(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return getCurrentLocale() === 'fr' ? s.replace('.', ',') : s;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${fmtNum(km, km < 10 ? 2 : 1)} km`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

// CO₂e (CO₂-equivalent): all factors are CO₂-equivalent, and flights add a
// radiative-forcing component, so the label reflects total warming impact.
export function formatCo2(grams: number): string {
  if (grams < 1000) return `${Math.round(grams)} g CO₂e`;
  const kg = grams / 1000;
  return `${fmtNum(kg, kg < 10 ? 2 : 1)} kg CO₂e`;
}

export function formatSpeed(mps: number): string {
  const kmh = mps * 3.6;
  return `${fmtNum(kmh, 1)} km/h`;
}

export function formatTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  return getCurrentLocale() === 'fr'
    ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
    : `${monthsShort()[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// "Wednesday, 3 Jun" / "Mercredi 3 juin" — day headers on the trips list and
// day view. Year appended when the date is not in the current year.
export function formatDayHeader(timestampMs: number, opts?: { short?: boolean }): string {
  const d = new Date(timestampMs);
  const fr = getCurrentLocale() === 'fr';
  const wd = (opts?.short ? weekdaysShort() : weekdays())[d.getDay()];
  const month = monthsShort()[d.getMonth()];
  const core = fr
    ? `${wd} ${d.getDate()} ${month?.toLowerCase()}`
    : `${wd}, ${d.getDate()} ${month}`;
  const y = d.getFullYear();
  return y === new Date().getFullYear() ? core : `${core} ${y}`;
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
