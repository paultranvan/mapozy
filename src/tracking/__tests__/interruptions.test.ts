import { computeInterruptions } from '../interruptions';
import { DIAGNOSTIC_EVENTS } from '../../db/diagnostics';
import type { DiagnosticEvent } from '../../db/diagnostics';

const MIN = 60_000;
const INTERVAL = 15 * MIN;
const NOW = 1_700_000_000_000;

let nextId = 1;
function ev(eventType: string, timestampMs: number): DiagnosticEvent {
  return { id: nextId++, timestampMs, eventType, payload: null };
}
function beats(t0: number, count: number): DiagnosticEvent[] {
  return Array.from({ length: count }, (_, i) =>
    ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, t0 + i * INTERVAL)
  );
}

beforeEach(() => {
  nextId = 1;
});

describe('computeInterruptions', () => {
  it('no interruptions when heartbeats are regular', () => {
    const events = beats(NOW - 10 * INTERVAL, 11);
    const r = computeInterruptions(events, { intervalMs: INTERVAL, nowMs: NOW });
    expect(r).toEqual([]);
  });

  it('detects a kill window between heartbeats and infers killed_recovered', () => {
    const before = beats(NOW - 20 * INTERVAL, 3);
    const gapEnd = NOW - 5 * INTERVAL;
    const after = [ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, gapEnd), ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, NOW)];
    const r = computeInterruptions([...before, ...after], { intervalMs: INTERVAL, nowMs: NOW });
    expect(r).toHaveLength(1);
    expect(r[0]!.startMs).toBe(before[before.length - 1]!.timestampMs);
    expect(r[0]!.endMs).toBe(gapEnd);
    expect(r[0]!.cause).toBe('killed_recovered');
    expect(r[0]!.durationMs).toBe(gapEnd - before[before.length - 1]!.timestampMs);
  });

  it('infers device_off when a boot event sits in the gap', () => {
    const before = beats(NOW - 20 * INTERVAL, 3);
    const last = before[before.length - 1]!.timestampMs;
    const boot = ev(DIAGNOSTIC_EVENTS.BOOT, last + 3 * INTERVAL);
    const resume = ev(DIAGNOSTIC_EVENTS.SVC_CREATE, last + 3 * INTERVAL + 1000);
    const r = computeInterruptions([...before, boot, resume, ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, NOW)], {
      intervalMs: INTERVAL,
      nowMs: NOW,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.cause).toBe('device_off');
  });

  it('infers killed_until_reopen when the gap ends with a manual svc_create (no boot, no watchdog)', () => {
    const before = beats(NOW - 20 * INTERVAL, 3);
    const reopen = ev(DIAGNOSTIC_EVENTS.SVC_CREATE, NOW - 2 * INTERVAL);
    const r = computeInterruptions([...before, reopen, ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, NOW)], {
      intervalMs: INTERVAL,
      nowMs: NOW,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.cause).toBe('killed_until_reopen');
  });

  it('reports an ongoing interruption when the last heartbeat is long ago', () => {
    const before = beats(NOW - 20 * INTERVAL, 3);
    const last = before[before.length - 1]!.timestampMs;
    const r = computeInterruptions(before, { intervalMs: INTERVAL, nowMs: NOW });
    expect(r).toHaveLength(1);
    expect(r[0]!.startMs).toBe(last);
    expect(r[0]!.endMs).toBe(NOW);
    expect(r[0]!.cause).toBe('ongoing');
  });

  it('ignores a single missed beat (within GAP_FACTOR)', () => {
    const events = [...beats(NOW - 5 * INTERVAL, 3), ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, NOW)];
    const r = computeInterruptions(events, { intervalMs: INTERVAL, nowMs: NOW });
    expect(r).toEqual([]);
  });

  it('returns newest-first', () => {
    const a = beats(NOW - 40 * INTERVAL, 2);
    const gap1End = ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, NOW - 30 * INTERVAL);
    const b = ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, NOW - 5 * INTERVAL);
    const c = ev(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE, NOW);
    const r = computeInterruptions([...a, gap1End, b, c], { intervalMs: INTERVAL, nowMs: NOW });
    expect(r.length).toBe(2);
    expect(r[0]!.startMs).toBeGreaterThan(r[1]!.startMs);
  });
});
