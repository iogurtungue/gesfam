import { describe, expect, it } from 'vitest';
import { afegeixDies, afegeixMesos, diesEntre, isoFromDateCell, parseFlexibleDate, parseNorma43Date } from './dates';

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

  it('converts a Date object using local fields (Excel serial dates, decoded by SheetJS relative to the reading machine\'s timezone)', () => {
    const d = new Date(2026, 6, 5);
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

describe('isoFromDateCell', () => {
  it('formats using local fields, not UTC (bug: shifted every date back a day for timezones ahead of UTC)', () => {
    expect(isoFromDateCell(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});

describe('afegeixDies', () => {
  it('adds days within the same month', () => {
    expect(afegeixDies('2026-07-05', 3)).toBe('2026-07-08');
  });

  it('crosses a month boundary', () => {
    expect(afegeixDies('2026-07-30', 3)).toBe('2026-08-02');
  });
});

describe('afegeixMesos', () => {
  it('preserves the day of month', () => {
    expect(afegeixMesos('2026-01-15', 1)).toBe('2026-02-15');
  });

  it('clamps to the last day of a shorter target month', () => {
    expect(afegeixMesos('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('crosses a year boundary', () => {
    expect(afegeixMesos('2026-12-05', 2)).toBe('2027-02-05');
  });
});

describe('diesEntre', () => {
  it('computes the number of days between two ISO dates', () => {
    expect(diesEntre('2026-07-05', '2026-07-08')).toBe(3);
    expect(diesEntre('2026-07-08', '2026-07-05')).toBe(-3);
  });
});
