import { describe, expect, it } from 'vitest';
import type { ParsedMoviment } from '../parsers/types';
import { computeMovimentId, splitNousIDuplicats } from './index';

function mov(overrides: Partial<ParsedMoviment> = {}): ParsedMoviment {
  return {
    dataOperacio: '2026-07-06',
    dataValor: '2026-07-06',
    concepteOriginal: 'RECIBO ENDESA',
    importCents: -4200,
    saldoPosteriorCents: 10000,
    ...overrides,
  };
}

describe('splitNousIDuplicats', () => {
  it('classifies movements not yet seen as new', () => {
    const { nous, duplicats } = splitNousIDuplicats('sabadell', 'compte-1', [mov()], new Set());
    expect(nous).toHaveLength(1);
    expect(duplicats).toBe(0);
    expect(nous[0].id).toBe(computeMovimentId('sabadell', 'compte-1', mov()));
  });

  it('drops movements whose id already exists (re-importing an overlapping statement)', () => {
    const moviment = mov();
    const existingId = computeMovimentId('sabadell', 'compte-1', moviment);
    const { nous, duplicats } = splitNousIDuplicats('sabadell', 'compte-1', [moviment], new Set([existingId]));
    expect(nous).toHaveLength(0);
    expect(duplicats).toBe(1);
  });

  it('keeps two (or more) legitimately identical same-day movements in the same import batch as separate new movements, not duplicates', () => {
    const moviment = mov();
    const { nous, duplicats } = splitNousIDuplicats('sabadell', 'compte-1', [moviment, { ...moviment }, { ...moviment }], new Set());
    expect(duplicats).toBe(0);
    expect(nous).toHaveLength(3);
    // First keeps the bare hash (compatible with data imported before this fix); later ones get a distinguishing suffix.
    const hash = computeMovimentId('sabadell', 'compte-1', moviment);
    expect(nous.map((m) => m.id)).toEqual([hash, `${hash}-2`, `${hash}-3`]);
  });

  it('recognizes a full re-import of the same repeated-hash group as all-duplicates, not just its first occurrence', () => {
    const moviment = mov();
    const hash = computeMovimentId('sabadell', 'compte-1', moviment);
    const existingIds = new Set([hash, `${hash}-2`, `${hash}-3`]);
    const { nous, duplicats } = splitNousIDuplicats('sabadell', 'compte-1', [moviment, { ...moviment }, { ...moviment }], existingIds);
    expect(nous).toHaveLength(0);
    expect(duplicats).toBe(3);
  });

  it('keeps two same-day identical-looking movements distinct when the running balance differs', () => {
    const a = mov({ saldoPosteriorCents: 10000 });
    const b = mov({ saldoPosteriorCents: 5800 }); // e.g. another -42,00 charge right after
    const { nous, duplicats } = splitNousIDuplicats('sabadell', 'compte-1', [a, b], new Set());
    expect(nous).toHaveLength(2);
    expect(duplicats).toBe(0);
  });

  it('keeps the same movement distinct across different accounts', () => {
    const moviment = mov();
    const existingId = computeMovimentId('sabadell', 'compte-1', moviment);
    const { nous, duplicats } = splitNousIDuplicats('sabadell', 'compte-2', [moviment], new Set([existingId]));
    expect(nous).toHaveLength(1);
    expect(duplicats).toBe(0);
  });
});
