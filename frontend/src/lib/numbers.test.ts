import { describe, expect, it } from 'vitest';
import { centsToEs } from './numbers';

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
