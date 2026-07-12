import { describe, expect, it } from 'vitest';
import { computeRecurrentHash } from '../lib/hash';
import type { ParsedRecurrentImport } from '../parsers/recurrentsFile';
import { splitNousRecurrentsIDuplicats } from './recurrents';

function inv(overrides: Partial<ParsedRecurrentImport> = {}): ParsedRecurrentImport {
  return {
    concepte: 'Proveïdor XYZ SL',
    importCents: -125000,
    dataPrevista: '2026-09-15',
    ...overrides,
  };
}

function hash(compteId: string, invoice: ParsedRecurrentImport): string {
  return computeRecurrentHash({ compteId, dataPrevista: invoice.dataPrevista, importCents: invoice.importCents, concepteOriginal: invoice.concepte });
}

describe('splitNousRecurrentsIDuplicats', () => {
  it('classifies an invoice not yet seen as new', () => {
    const invoice = inv();
    const { nous, duplicats } = splitNousRecurrentsIDuplicats('compte-1', [invoice], new Set());
    expect(nous).toHaveLength(1);
    expect(duplicats).toBe(0);
    expect(nous[0].id).toBe(hash('compte-1', invoice));
  });

  it('drops an invoice whose id already exists (re-importing the same file)', () => {
    const invoice = inv();
    const existingId = hash('compte-1', invoice);
    const { nous, duplicats } = splitNousRecurrentsIDuplicats('compte-1', [invoice], new Set([existingId]));
    expect(nous).toHaveLength(0);
    expect(duplicats).toBe(1);
  });

  it('keeps two (or more) coincidentally identical invoices in the same batch as separate new rows, not duplicates', () => {
    const invoice = inv();
    const { nous, duplicats } = splitNousRecurrentsIDuplicats('compte-1', [invoice, { ...invoice }, { ...invoice }], new Set());
    expect(duplicats).toBe(0);
    expect(nous).toHaveLength(3);
    const h = hash('compte-1', invoice);
    expect(nous.map((r) => r.id)).toEqual([h, `${h}-2`, `${h}-3`]);
  });

  it('recognizes a full re-import of the same repeated-hash group as all-duplicates, not just its first occurrence', () => {
    const invoice = inv();
    const h = hash('compte-1', invoice);
    const existingIds = new Set([h, `${h}-2`, `${h}-3`]);
    const { nous, duplicats } = splitNousRecurrentsIDuplicats('compte-1', [invoice, { ...invoice }, { ...invoice }], existingIds);
    expect(nous).toHaveLength(0);
    expect(duplicats).toBe(3);
  });

  it('keeps the same invoice distinct across different accounts', () => {
    const invoice = inv();
    const existingId = hash('compte-1', invoice);
    const { nous, duplicats } = splitNousRecurrentsIDuplicats('compte-2', [invoice], new Set([existingId]));
    expect(nous).toHaveLength(1);
    expect(duplicats).toBe(0);
  });

  it('preserves categoriaNom and referencia on the new row', () => {
    const invoice = inv({ categoriaNom: 'Proveïdors', referencia: 'FRA-2026-0042' });
    const { nous } = splitNousRecurrentsIDuplicats('compte-1', [invoice], new Set());
    expect(nous[0].categoriaNom).toBe('Proveïdors');
    expect(nous[0].referencia).toBe('FRA-2026-0042');
  });
});
