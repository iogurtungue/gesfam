import { describe, expect, it } from 'vitest';
import type { ReglaLiquidacioTargeta } from '../db/types';
import { pickTargetaLiquidacio } from './liquidacioTargeta';

function regla(patro: string, targetaCompteId: string): ReglaLiquidacioTargeta {
  return { id: `r-${patro}`, patro, targetaCompteId };
}

describe('pickTargetaLiquidacio', () => {
  it('matches a rule whose pattern is a substring of the normalized concept', () => {
    const regles = [regla('LIQUIDACION TARJETA', 'targeta-1')];
    expect(pickTargetaLiquidacio('LIQUIDACION TARJETA VISA', regles)).toBe('targeta-1');
  });

  it('is case-insensitive', () => {
    const regles = [regla('liquidacion tarjeta visa', 'targeta-1')];
    expect(pickTargetaLiquidacio('LIQUIDACION TARJETA VISA', regles)).toBe('targeta-1');
  });

  it('returns undefined when no rule matches', () => {
    expect(pickTargetaLiquidacio('SUPERMERCAT', [regla('LIQUIDACION', 'targeta-1')])).toBeUndefined();
  });

  it('picks the first matching rule when several match', () => {
    const regles = [regla('LIQUIDACION TARJETA VISA', 'targeta-1'), regla('LIQUIDACION TARJETA MASTERCARD', 'targeta-2')];
    expect(pickTargetaLiquidacio('LIQUIDACION TARJETA MASTERCARD', regles)).toBe('targeta-2');
  });

  it('ignores blank patterns', () => {
    expect(pickTargetaLiquidacio('QUALSEVOL COSA', [regla('', 'targeta-1')])).toBeUndefined();
  });
});
