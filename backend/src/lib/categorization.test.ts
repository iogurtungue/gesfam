import { describe, expect, it } from 'vitest';
import type { ReglaCategoritzacio } from '../db/types';
import { pickCategoriaId } from './categorization';

function regla(patro: string, categoriaId: string, prioritat: number): ReglaCategoritzacio {
  return { id: `r-${patro}`, patro, categoriaId, prioritat };
}

describe('pickCategoriaId', () => {
  it('matches a rule whose pattern is a substring of the normalized concept', () => {
    const regles = [regla('ENDESA', 'cat-subministraments', 1)];
    expect(pickCategoriaId('RECIBO ENDESA ENERGIA XXI', regles)).toBe('cat-subministraments');
  });

  it('is case-insensitive', () => {
    const regles = [regla('endesa', 'cat-subministraments', 1)];
    expect(pickCategoriaId('RECIBO ENDESA ENERGIA XXI', regles)).toBe('cat-subministraments');
  });

  it('returns undefined when no rule matches', () => {
    expect(pickCategoriaId('COMPRA DESCONEGUDA', [regla('ENDESA', 'cat-subministraments', 1)])).toBeUndefined();
  });

  it('applies the lowest-priority matching rule first when several match', () => {
    const regles = [regla('COMPRA', 'cat-generic', 2), regla('COMPRA BON AREA', 'cat-alimentacio', 1)];
    expect(pickCategoriaId('COMPRA BON AREA IGUALADA', regles)).toBe('cat-alimentacio');
  });

  it('ignores blank patterns', () => {
    expect(pickCategoriaId('QUALSEVOL COSA', [regla('', 'cat-x', 1)])).toBeUndefined();
  });
});
