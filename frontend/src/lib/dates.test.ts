import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { avui, faDiesAbans, formatDateEs } from './dates';

describe('formatDateEs', () => {
  it('formats an ISO date in Spanish dd/mm/aaaa convention', () => {
    expect(formatDateEs('2026-07-06')).toBe('06/07/2026');
  });
});

describe('faDiesAbans', () => {
  it('subtracts the given number of days within the same month', () => {
    expect(faDiesAbans('2026-07-12', 5)).toBe('2026-07-07');
  });

  it('crosses a month boundary', () => {
    expect(faDiesAbans('2026-07-12', 60)).toBe('2026-05-13');
  });

  it('crosses a year boundary', () => {
    expect(faDiesAbans('2026-01-15', 30)).toBe('2025-12-16');
  });
});

describe('avui', () => {
  const tzOriginal = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Madrid';
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.TZ = tzOriginal;
    vi.useRealTimers();
  });

  it('returns the local calendar date, not the UTC date (regression: toISOString() is always UTC)', () => {
    // 2026-07-05 22:30 UTC is already 2026-07-06 00:30 in Madrid (CEST, UTC+2).
    // The old `toISOString().slice(0, 10)` implementation returned "2026-07-05"
    // here — yesterday, from the user's point of view — which silently
    // excluded today's just-imported movements from balance calculations that
    // use "up to today" as their cutoff (Dashboard, Saldos a una data).
    vi.setSystemTime(new Date('2026-07-05T22:30:00.000Z'));
    expect(avui()).toBe('2026-07-06');
  });

  it('matches the UTC date too when there is no offset-driven day boundary crossing', () => {
    vi.setSystemTime(new Date('2026-07-06T10:00:00.000Z'));
    expect(avui()).toBe('2026-07-06');
  });
});
