import { describe, expect, it } from 'vitest';
import { applyColumnMapping, type ColumnMapping } from './columnMapping';
import type { RawTable } from './types';

describe('applyColumnMapping', () => {
  it('extracts movements using a user-defined mapping for an unrecognised format', () => {
    const table: RawTable = [
      ['Date', 'Detail 1', 'Detail 2', 'Amount', 'Balance'],
      ['06/07/2026', 'Grocery', 'store XYZ', '-42,00', '1.000,00'],
    ];
    const mapping: ColumnMapping = {
      banc: 'altre',
      tipus: 'corrent',
      headerRowIndex: 0,
      dataOperacioCol: 0,
      concepteCols: [1, 2],
      importCol: 3,
      saldoCol: 4,
    };

    const { moviments, warnings } = applyColumnMapping(table, mapping);
    expect(warnings).toEqual([]);
    expect(moviments).toEqual([
      {
        dataOperacio: '2026-07-06',
        dataValor: '2026-07-06',
        concepteOriginal: 'Grocery - store XYZ',
        importCents: -4200,
        saldoPosteriorCents: 100000,
      },
    ]);
  });
});
