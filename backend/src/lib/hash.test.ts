import { describe, expect, it } from 'vitest';
import { computeContrapartidaId, computeMovimentHash, computeRecurrentHash, type MovimentHashInput, type RecurrentHashInput } from './hash';

const base: MovimentHashInput = {
  banc: 'sabadell',
  compteId: 'compte-1',
  dataOperacio: '2026-07-06',
  importCents: -1800,
  concepteOriginal: 'COMPRA TARG ANTHROPIC* CLAUDE SUB',
  saldoPosteriorCents: 432373,
};

describe('computeMovimentHash', () => {
  it('is deterministic for identical input', () => {
    expect(computeMovimentHash(base)).toBe(computeMovimentHash({ ...base }));
  });

  it('is insensitive to concept casing/whitespace (dedup-relevant normalization)', () => {
    expect(computeMovimentHash(base)).toBe(
      computeMovimentHash({ ...base, concepteOriginal: '  compra targ   anthropic* claude sub ' }),
    );
  });

  it('differs when the amount differs', () => {
    expect(computeMovimentHash(base)).not.toBe(computeMovimentHash({ ...base, importCents: -1801 }));
  });

  it('differs when the running balance differs (same-day identical movements)', () => {
    expect(computeMovimentHash(base)).not.toBe(computeMovimentHash({ ...base, saldoPosteriorCents: 432374 }));
  });

  it('differs across accounts even with identical movement data', () => {
    expect(computeMovimentHash(base)).not.toBe(computeMovimentHash({ ...base, compteId: 'compte-2' }));
  });
});

describe('computeContrapartidaId', () => {
  it('is deterministic for the same origin movement id (idempotent across re-marking/reimports)', () => {
    expect(computeContrapartidaId('moviment-1')).toBe(computeContrapartidaId('moviment-1'));
  });

  it('differs across origin movement ids', () => {
    expect(computeContrapartidaId('moviment-1')).not.toBe(computeContrapartidaId('moviment-2'));
  });

  it('never collides with a real movement hash of the same origin id (distinct id spaces)', () => {
    expect(computeContrapartidaId('moviment-1')).not.toBe(computeMovimentHash({ ...base, compteId: 'moviment-1' }));
  });
});

const baseRecurrent: RecurrentHashInput = {
  compteId: 'compte-1',
  dataPrevista: '2026-09-15',
  importCents: -125000,
  concepteOriginal: 'Proveïdor XYZ SL',
};

describe('computeRecurrentHash', () => {
  it('is deterministic for identical input (reimporting the same invoice file does not duplicate rows)', () => {
    expect(computeRecurrentHash(baseRecurrent)).toBe(computeRecurrentHash({ ...baseRecurrent }));
  });

  it('is insensitive to concept casing/whitespace', () => {
    expect(computeRecurrentHash(baseRecurrent)).toBe(computeRecurrentHash({ ...baseRecurrent, concepteOriginal: '  proveïdor   xyz sl ' }));
  });

  it('differs when the due date differs', () => {
    expect(computeRecurrentHash(baseRecurrent)).not.toBe(computeRecurrentHash({ ...baseRecurrent, dataPrevista: '2026-09-16' }));
  });

  it('differs when the amount differs', () => {
    expect(computeRecurrentHash(baseRecurrent)).not.toBe(computeRecurrentHash({ ...baseRecurrent, importCents: -125001 }));
  });

  it('differs across accounts even with identical invoice data', () => {
    expect(computeRecurrentHash(baseRecurrent)).not.toBe(computeRecurrentHash({ ...baseRecurrent, compteId: 'compte-2' }));
  });

  it('never collides with a movement hash or a contrapartida id built from the same field values', () => {
    expect(computeRecurrentHash(baseRecurrent)).not.toBe(
      computeMovimentHash({
        banc: 'sabadell',
        compteId: baseRecurrent.compteId,
        dataOperacio: baseRecurrent.dataPrevista,
        importCents: baseRecurrent.importCents,
        concepteOriginal: baseRecurrent.concepteOriginal,
        saldoPosteriorCents: null,
      }),
    );
    expect(computeRecurrentHash(baseRecurrent)).not.toBe(computeContrapartidaId(baseRecurrent.compteId));
  });
});
