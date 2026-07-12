import { describe, expect, it } from 'vitest';
import { normalizeConceptForDedup, normalizeConceptForRecurrence } from './concept';

describe('normalizeConceptForDedup', () => {
  it('uppercases, trims and collapses whitespace', () => {
    expect(normalizeConceptForDedup('  Recibo   Endesa  ')).toBe('RECIBO ENDESA');
  });
});

describe('normalizeConceptForRecurrence', () => {
  it('groups two occurrences that only differ by a variable reference number (spec 4.1.1 example)', () => {
    expect(normalizeConceptForRecurrence('RECIBO ENDESA REF 0012345')).toBe(normalizeConceptForRecurrence('RECIBO ENDESA REF 0012399'));
    expect(normalizeConceptForRecurrence('RECIBO ENDESA REF 0012345')).toBe('RECIBO ENDESA REF');
  });

  it('keeps short numbers that are part of the concept, not a reference', () => {
    expect(normalizeConceptForRecurrence('N26 PLAN 5')).toBe('N26 PLAN 5');
  });

  it('collapses the extra whitespace left behind after stripping a reference number', () => {
    expect(normalizeConceptForRecurrence('COMPRA 12345 MERCADONA')).toBe('COMPRA MERCADONA');
  });

  it('is uppercase and trimmed, like normalizeConceptForDedup', () => {
    expect(normalizeConceptForRecurrence('  recibo endesa  ')).toBe('RECIBO ENDESA');
  });
});
