import { describe, expect, it } from 'vitest';
import { parseAmountToCents } from './numbers';

describe('parseAmountToCents', () => {
  it('parses a native number by scaling to cents', () => {
    expect(parseAmountToCents(763.44)).toBe(76344);
    expect(parseAmountToCents(-1.5)).toBe(-150);
  });

  it('parses Spanish comma-decimal amounts', () => {
    expect(parseAmountToCents('-763,44')).toBe(-76344);
    expect(parseAmountToCents('57,90')).toBe(5790);
  });

  it('parses comma-decimal with dot thousands separators', () => {
    expect(parseAmountToCents('1.234,56')).toBe(123456);
    expect(parseAmountToCents('-12.345,67')).toBe(-1234567);
  });

  it('parses dot-decimal amounts with two digits as decimals', () => {
    expect(parseAmountToCents('20.27')).toBe(2027);
    expect(parseAmountToCents('-1.50')).toBe(-150);
  });

  it('treats a dot followed by exactly three digits as a thousands separator', () => {
    expect(parseAmountToCents('1.234')).toBe(123400);
  });

  it('handles a plain integer with no separators', () => {
    expect(parseAmountToCents('42')).toBe(4200);
  });

  it('handles parenthesised negative amounts', () => {
    expect(parseAmountToCents('(60,00)')).toBe(-6000);
  });

  it('strips currency symbols and whitespace', () => {
    expect(parseAmountToCents('1.052,79 €')).toBe(105279);
  });

  it('throws on an unparsable amount', () => {
    expect(() => parseAmountToCents('n/a')).toThrow();
    expect(() => parseAmountToCents('')).toThrow();
  });
});
