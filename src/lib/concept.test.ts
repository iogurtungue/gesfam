import { describe, expect, it } from 'vitest';
import { normalizeConceptForDedup } from './concept';

describe('normalizeConceptForDedup', () => {
  it('uppercases, trims and collapses whitespace', () => {
    expect(normalizeConceptForDedup('  Recibo   Endesa  ')).toBe('RECIBO ENDESA');
  });
});
