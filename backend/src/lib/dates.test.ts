import { describe, expect, it } from 'vitest';
import { isoFromUTCDate, parseFlexibleDate, parseNorma43Date } from './dates';

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
