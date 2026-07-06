import { describe, expect, it } from 'vitest';
import { computeMovimentHash, type MovimentHashInput } from './hash';

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
