import { getCurrentLocale, t } from '@/i18n';
import { monthsShort } from '@/i18n/dates';

export function startOfDayMs(timestampMs: number): number {
  const d = new Date(timestampMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDayMs(timestampMs: number): number {
  const d = new Date(timestampMs);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function dayKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Local-midnight timestamp for a `YYYY-MM-DD` key (inverse of dayKey).
export function dayKeyToMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

// [startOfDay, endOfDay] ms range covering a `YYYY-MM-DD` key.
export function rangeForDayKey(key: string): [number, number] {
  const base = dayKeyToMs(key);
  return [startOfDayMs(base), endOfDayMs(base)];
}

// The day key `deltaDays` away from `key` (e.g. -1 = previous day).
export function shiftDayKey(key: string, deltaDays: number): string {
  return dayKey(dayKeyToMs(key) + deltaDays * 86_400_000);
}

export type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'all';

// "Jun 3" / "3 juin" — locale-aware month-day label for period navigation.
function monthDay(month: number, day: number): string {
  const m = monthsShort()[month];
  return getCurrentLocale() === 'fr' ? `${day} ${m?.toLowerCase()}` : `${m} ${day}`;
}

// Monday-aligned start of the local week containing `d`.
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}

export interface NavPeriodRange {
  start: number;
  end: number;
  label: string;
  // False once the period reaches the one containing "now" — there's no data
  // in the future, so the UI disables the forward arrow.
  canGoForward: boolean;
}

// A calendar-aligned period shifted by `offset` units back (negative) or
// forward, with a human label. Aligned to real calendar weeks/months/years so
// users can page through their history one week/month/year at a time.
// `offset === 0` is the current period; `offset` is clamped at the caller's
// discretion.
export function navigablePeriodRange(
  period: PeriodKey,
  offset: number,
  nowMs: number = Date.now()
): NavPeriodRange {
  const now = new Date(nowMs);
  switch (period) {
    case 'all':
      return { start: 0, end: endOfDayMs(nowMs), label: t('period.allTime'), canGoForward: false };
    case 'today': {
      const base = new Date(nowMs);
      base.setDate(base.getDate() + offset);
      const label =
        offset === 0
          ? t('period.today')
          : offset === -1
            ? t('period.yesterday')
            : monthDay(base.getMonth(), base.getDate());
      return {
        start: startOfDayMs(base.getTime()),
        end: endOfDayMs(base.getTime()),
        label,
        canGoForward: offset < 0,
      };
    }
    case 'week': {
      const ws = startOfWeek(now);
      ws.setDate(ws.getDate() + offset * 7);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      const label =
        offset === 0
          ? t('period.thisWeek')
          : sameMonth
            ? getCurrentLocale() === 'fr'
              ? `${ws.getDate()}–${we.getDate()} ${monthsShort()[ws.getMonth()]?.toLowerCase()}`
              : `${monthsShort()[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}`
            : `${monthDay(ws.getMonth(), ws.getDate())} – ${monthDay(we.getMonth(), we.getDate())}`;
      return {
        start: ws.getTime(),
        end: endOfDayMs(we.getTime()),
        label,
        canGoForward: offset < 0,
      };
    }
    case 'month': {
      const m = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const next = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
      const label =
        offset === 0
          ? t('period.thisMonth')
          : `${monthsShort()[m.getMonth()]} ${m.getFullYear()}`;
      return { start: m.getTime(), end: next.getTime() - 1, label, canGoForward: offset < 0 };
    }
    case 'year': {
      const y = now.getFullYear() + offset;
      const start = new Date(y, 0, 1).getTime();
      const end = new Date(y + 1, 0, 1).getTime() - 1;
      const label = offset === 0 ? t('period.thisYear') : String(y);
      return { start, end, label, canGoForward: offset < 0 };
    }
  }
}
