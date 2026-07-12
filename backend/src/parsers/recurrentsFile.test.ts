import { describe, expect, it } from 'vitest';
import { parseRecurrentsFile } from './recurrentsFile';
import type { RawTable } from './types';

describe('parseRecurrentsFile', () => {
  it('parses required columns (Data de venciment, Concepte, Import)', () => {
    const table: RawTable = [
      ['Data de venciment', 'Concepte', 'Import'],
      ['15/09/2026', 'Proveïdor XYZ SL', '-1250,00'],
    ];
    const { recurrents, warnings } = parseRecurrentsFile(table);
    expect(warnings).toEqual([]);
    expect(recurrents).toEqual([{ concepte: 'Proveïdor XYZ SL', importCents: -125000, dataPrevista: '2026-09-15', categoriaNom: undefined, referencia: undefined }]);
  });

  it('parses optional Categoria and Referència columns when present', () => {
    const table: RawTable = [
      ['Data de venciment', 'Concepte', 'Import', 'Categoria', 'Referència'],
      ['15/09/2026', 'Proveïdor XYZ SL', '-1250,00', 'Proveïdors', 'FRA-2026-0042'],
    ];
    const { recurrents, warnings } = parseRecurrentsFile(table);
    expect(warnings).toEqual([]);
    expect(recurrents).toEqual([
      { concepte: 'Proveïdor XYZ SL', importCents: -125000, dataPrevista: '2026-09-15', categoriaNom: 'Proveïdors', referencia: 'FRA-2026-0042' },
    ]);
  });

  it('accepts a real Excel date cell (JS Date) for the venciment column, like ING\'s binary .xls', () => {
    const table: RawTable = [
      ['Data de venciment', 'Concepte', 'Import'],
      [new Date(2026, 8, 15), 'Proveïdor XYZ SL', -1250],
    ];
    const { recurrents } = parseRecurrentsFile(table);
    expect(recurrents[0].dataPrevista).toBe('2026-09-15');
    expect(recurrents[0].importCents).toBe(-125000);
  });

  it('tolerates a preamble above the header row, matching by header text not position', () => {
    const table: RawTable = [
      ['Factures pendents', ''],
      ['', ''],
      ['Data de venciment', 'Concepte', 'Import'],
      ['15/09/2026', 'Proveïdor XYZ SL', '-1250,00'],
    ];
    const { recurrents } = parseRecurrentsFile(table);
    expect(recurrents).toHaveLength(1);
  });

  it('skips blank rows silently', () => {
    const table: RawTable = [
      ['Data de venciment', 'Concepte', 'Import'],
      ['', '', ''],
      ['15/09/2026', 'Proveïdor XYZ SL', '-1250,00'],
    ];
    const { recurrents, warnings } = parseRecurrentsFile(table);
    expect(recurrents).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('reports an unparseable row (bad date) as a warning without losing the rest of the batch', () => {
    const table: RawTable = [
      ['Data de venciment', 'Concepte', 'Import'],
      ['no-és-una-data', 'Proveïdor XYZ SL', '-1250,00'],
      ['16/09/2026', 'Un altre proveïdor', '-300,00'],
    ];
    const { recurrents, warnings } = parseRecurrentsFile(table);
    expect(recurrents).toHaveLength(1);
    expect(recurrents[0].concepte).toBe('Un altre proveïdor');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Fila 2');
  });

  it('reports a row with an empty concepte as a warning', () => {
    const table: RawTable = [
      ['Data de venciment', 'Concepte', 'Import'],
      ['15/09/2026', '', '-1250,00'],
    ];
    const { recurrents, warnings } = parseRecurrentsFile(table);
    expect(recurrents).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('throws when the expected header is not found at all', () => {
    const table: RawTable = [['Fecha', 'Concepto', 'Importe']];
    expect(() => parseRecurrentsFile(table)).toThrow();
  });
});
