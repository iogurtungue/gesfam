import { describe, expect, it } from 'vitest';
import { centsToEs, eurosToCents } from './numbers';

describe('centsToEs', () => {
  it('formats with the € symbol and thousands separator by default', () => {
    expect(centsToEs(123456)).toBe('1.234,56 €');
    expect(centsToEs(-123456)).toBe('-1.234,56 €');
  });

  it('groups multiple thousands', () => {
    expect(centsToEs(123456789)).toBe('1.234.567,89 €');
  });

  it('omits the € symbol when ambSimbol is false, keeping the thousands separator', () => {
    expect(centsToEs(123456, false)).toBe('1.234,56');
    expect(centsToEs(-123456, false)).toBe('-1.234,56');
  });
});

describe('eurosToCents', () => {
  it('parses a euro amount with a dot decimal separator', () => {
    expect(eurosToCents('12.34')).toBe(1234);
  });

  it('parses a euro amount with a comma decimal separator', () => {
    expect(eurosToCents('12,34')).toBe(1234);
  });

  it('parses a negative amount', () => {
    expect(eurosToCents('-50')).toBe(-5000);
  });

  it('returns null for an empty or blank string', () => {
    expect(eurosToCents('')).toBeNull();
    expect(eurosToCents('   ')).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(eurosToCents('abc')).toBeNull();
  });
});
