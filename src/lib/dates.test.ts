import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { avui, formatDateEs, isoFromUTCDate, parseFlexibleDate, parseNorma43Date } from './dates';

describe('formatDateEs', () => {
  it('formats an ISO date in Spanish dd/mm/aaaa convention', () => {
    expect(formatDateEs('2026-07-06')).toBe('06/07/2026');
  });
});

describe('parseFlexibleDate', () => {
  it('parses dd/mm/yyyy strings', () => {
    expect(parseFlexibleDate('06/07/2026')).toBe('2026-07-06');
    expect(parseFlexibleDate('1/7/2026')).toBe('2026-07-01');
  });

  it('parses dd/mm/yy strings assuming the 21st century', () => {
    expect(parseFlexibleDate('06/07/26')).toBe('2026-07-06');
  });

  it('passes through ISO date strings', () => {
    expect(parseFlexibleDate('2026-06-29')).toBe('2026-06-29');
  });

  it('converts a Date object using UTC fields (Excel serial dates)', () => {
    const d = new Date(Date.UTC(2026, 6, 5));
    expect(parseFlexibleDate(d)).toBe('2026-07-05');
  });

  it('throws on an unrecognised format', () => {
    expect(() => parseFlexibleDate('not a date')).toThrow();
  });
});

describe('parseNorma43Date', () => {
  it('parses AAMMDD into an ISO date assuming the 21st century', () => {
    expect(parseNorma43Date('260706')).toBe('2026-07-06');
  });

  it('throws on malformed input', () => {
    expect(() => parseNorma43Date('2607')).toThrow();
    expect(() => parseNorma43Date('26-07-06')).toThrow();
  });
});

describe('isoFromUTCDate', () => {
  it('formats using UTC fields', () => {
    expect(isoFromUTCDate(new Date(Date.UTC(2026, 0, 9)))).toBe('2026-01-09');
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
