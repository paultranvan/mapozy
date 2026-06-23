import { navigablePeriodRange } from '../time';

// Fixed reference: Wednesday 2026-06-24 15:00 local.
const NOW = new Date(2026, 5, 24, 15, 0, 0).getTime();

describe('navigablePeriodRange', () => {
  it('month offset 0 spans the current calendar month and forbids forward', () => {
    const r = navigablePeriodRange('month', 0, NOW);
    expect(new Date(r.start).getDate()).toBe(1);
    expect(new Date(r.start).getMonth()).toBe(5); // June
    expect(new Date(r.end).getMonth()).toBe(5);
    expect(new Date(r.end).getDate()).toBe(30);
    expect(r.label).toBe('this month');
    expect(r.canGoForward).toBe(false);
  });

  it('month offset -1 is the previous calendar month, labelled, forward enabled', () => {
    const r = navigablePeriodRange('month', -1, NOW);
    expect(new Date(r.start).getMonth()).toBe(4); // May
    expect(new Date(r.start).getDate()).toBe(1);
    expect(new Date(r.end).getMonth()).toBe(4);
    expect(new Date(r.end).getDate()).toBe(31);
    expect(r.label).toBe('May 2026');
    expect(r.canGoForward).toBe(true);
  });

  it('week offset 0 starts on Monday and ends on Sunday', () => {
    const r = navigablePeriodRange('week', 0, NOW);
    // 2026-06-24 is a Wednesday → Monday is 2026-06-22.
    expect(new Date(r.start).getDay()).toBe(1); // Monday
    expect(new Date(r.start).getDate()).toBe(22);
    expect(new Date(r.end).getDay()).toBe(0); // Sunday
    expect(new Date(r.end).getDate()).toBe(28);
    expect(r.canGoForward).toBe(false);
  });

  it('week offset -1 is the prior Mon–Sun window', () => {
    const r = navigablePeriodRange('week', -1, NOW);
    expect(new Date(r.start).getDate()).toBe(15);
    expect(new Date(r.end).getDate()).toBe(21);
    expect(r.label).toBe('Jun 15–21');
    expect(r.canGoForward).toBe(true);
  });

  it('year offset -1 spans the previous calendar year', () => {
    const r = navigablePeriodRange('year', -1, NOW);
    expect(new Date(r.start).getFullYear()).toBe(2025);
    expect(new Date(r.start).getMonth()).toBe(0);
    expect(new Date(r.end).getFullYear()).toBe(2025);
    expect(new Date(r.end).getMonth()).toBe(11);
    expect(r.label).toBe('2025');
  });

  it('all ignores offset and never paginates', () => {
    const r = navigablePeriodRange('all', -3, NOW);
    expect(r.start).toBe(0);
    expect(r.canGoForward).toBe(false);
    expect(r.label).toBe('all time');
  });
});
