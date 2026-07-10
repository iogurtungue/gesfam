import { describe, expect, it } from 'vitest';
import {
  esRetiradaEfectiu,
  suggereixAparellamentsLiquidacioDirecta,
  type CandidatAparellamentDirecte,
} from './liquidacioDirecta';
import type { ReglaLiquidacioDirecta } from '../db/types';

function regla(patro: string): ReglaLiquidacioDirecta {
  return { id: patro, patro };
}

function mov(id: string, dataOperacio: string, importCents: number): CandidatAparellamentDirecte {
  return { id, dataOperacio, importCents };
}

describe('esRetiradaEfectiu', () => {
  it('matches a concept containing one of the configured patterns, case-insensitively', () => {
    const regles = [regla('RETIRADA EFECTIVO'), regla('CAJERO')];
    expect(esRetiradaEfectiu('RETIRADA EFECTIVO CAJERO 1234 BARCELONA', regles)).toBe(true);
  });

  it('returns false when no rule matches', () => {
    expect(esRetiradaEfectiu('COMPRA MERCADONA', [regla('CAJERO')])).toBe(false);
  });

  it('ignores blank patterns', () => {
    expect(esRetiradaEfectiu('CAJERO AUTOMATICO', [regla('  ')])).toBe(false);
  });

  it('returns false for an empty rule set', () => {
    expect(esRetiradaEfectiu('CAJERO AUTOMATICO', [])).toBe(false);
  });
});

describe('suggereixAparellamentsLiquidacioDirecta', () => {
  it('pairs a card withdrawal with the checking-account charge of the same amount within the date window', () => {
    const targeta = [mov('t1', '2026-06-10', -20000)];
    const corrent = [mov('c1', '2026-06-11', -20000)];
    expect(suggereixAparellamentsLiquidacioDirecta(targeta, corrent)).toEqual([{ targetaMovimentId: 't1', correntMovimentId: 'c1' }]);
  });

  it('does not pair movements of different amounts', () => {
    const targeta = [mov('t1', '2026-06-10', -20000)];
    const corrent = [mov('c1', '2026-06-11', -15000)];
    expect(suggereixAparellamentsLiquidacioDirecta(targeta, corrent)).toEqual([]);
  });

  it('does not pair opposite-sign movements (unlike an internal transfer)', () => {
    const targeta = [mov('t1', '2026-06-10', -20000)];
    const corrent = [mov('c1', '2026-06-11', 20000)];
    expect(suggereixAparellamentsLiquidacioDirecta(targeta, corrent)).toEqual([]);
  });

  it('does not pair movements further apart than the day window', () => {
    const targeta = [mov('t1', '2026-06-01', -20000)];
    const corrent = [mov('c1', '2026-06-10', -20000)];
    expect(suggereixAparellamentsLiquidacioDirecta(targeta, corrent, 2)).toEqual([]);
  });

  it('picks the closest date when several candidates share the same amount', () => {
    const targeta = [mov('t1', '2026-06-10', -20000)];
    const corrent = [mov('lluny', '2026-06-08', -20000), mov('a-prop', '2026-06-11', -20000)];
    expect(suggereixAparellamentsLiquidacioDirecta(targeta, corrent)).toEqual([{ targetaMovimentId: 't1', correntMovimentId: 'a-prop' }]);
  });

  it('does not reuse an already-matched checking-account movement for a second card withdrawal', () => {
    const targeta = [mov('t1', '2026-06-10', -20000), mov('t2', '2026-06-10', -20000)];
    const corrent = [mov('c1', '2026-06-11', -20000)];
    const result = suggereixAparellamentsLiquidacioDirecta(targeta, corrent);
    expect(result).toHaveLength(1);
  });
});
