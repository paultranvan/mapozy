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

export type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'all';

export function periodToRange(period: PeriodKey, nowMs: number = Date.now()): [number, number] {
  const now = new Date(nowMs);
  const end = endOfDayMs(nowMs);
  const start = new Date(now);
  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      return [start.getTime(), end];
    case 'week':
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return [start.getTime(), end];
    case 'month':
      start.setMonth(now.getMonth(), now.getDate());
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return [start.getTime(), end];
    case 'year':
      start.setFullYear(now.getFullYear() - 1);
      start.setHours(0, 0, 0, 0);
      return [start.getTime(), end];
    case 'all':
      return [0, end];
  }
}
