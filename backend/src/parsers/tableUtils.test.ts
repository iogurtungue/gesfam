import { describe, expect, it } from 'vitest';
import { findLabeledValue, locateColumns } from './tableUtils';
import type { RawTable } from './types';

describe('findLabeledValue', () => {
  it('finds the value in the same row, immediately after the label', () => {
    const table: RawTable = [['Fecha de exportación:', '06/07/2026 12:44h'], ['Número de cuenta:', '1465 0120 3417 37242976']];
    expect(findLabeledValue(table, ['NÚMERO DE CUENTA'])).toBe('14650120341737242976');
  });

  it('skips blank cells between the label and the value (BBVA layout)', () => {
    const table: RawTable = [['', '', 'Número de targeta', '', '5478240008165056', '']];
    expect(findLabeledValue(table, ['NÚMERO DE TARGETA'])).toBe('5478240008165056');
  });

  it('returns undefined when the label is not present', () => {
    const table: RawTable = [['Fecha', 'Concepto', 'Importe']];
    expect(findLabeledValue(table, ['NÚMERO DE CUENTA'])).toBeUndefined();
  });

  it('is not fooled by an unrelated label that only shares a word', () => {
    const table: RawTable = [['Número de contracte', 'ABC123'], ['Número de cuenta', 'XYZ789']];
    expect(findLabeledValue(table, ['NÚMERO DE CUENTA'])).toBe('XYZ789');
  });
});

describe('locateColumns', () => {
  it('finds the header row skipping preamble rows, matching by text not position', () => {
    const table: RawTable = [
      ['Some title', '', ''],
      ['', '', ''],
      ['Fecha', 'Concepto', 'Importe (€)'],
      ['06/07/2026', 'Test', '-5,00'],
    ];
    const located = locateColumns(table, [
      { key: 'data', patterns: ['FECHA'] },
      { key: 'concepte', patterns: ['CONCEPTO'] },
      { key: 'importe', patterns: ['IMPORTE'] },
    ]);
    expect(located).toEqual({ headerRowIndex: 2, columns: { data: 0, concepte: 1, importe: 2 } });
  });

  it('returns null when a required column is missing from every row', () => {
    const table: RawTable = [['Fecha', 'Concepto']];
    const located = locateColumns(table, [
      { key: 'data', patterns: ['FECHA'] },
      { key: 'saldo', patterns: ['SALDO'] },
    ]);
    expect(located).toBeNull();
  });

  it('ignores optional columns marked required:false when absent', () => {
    const table: RawTable = [['Fecha', 'Concepto', 'Importe']];
    const located = locateColumns(table, [
      { key: 'data', patterns: ['FECHA'] },
      { key: 'saldo', patterns: ['SALDO'], required: false },
    ]);
    expect(located).toEqual({ headerRowIndex: 0, columns: { data: 0 } });
  });
});
