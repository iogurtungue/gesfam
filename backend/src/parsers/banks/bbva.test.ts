import { describe, expect, it } from 'vitest';
import type { RawTable } from '../types';
import { parseBbvaCard } from './bbva';

describe('parseBbvaCard', () => {
  it('extracts card movements from the Catalan-header export', () => {
    const table: RawTable = [
      ['', '', 'Llista de moviments de targeta', '', ''],
      ['', '', "Titular de la targeta", '', 'NOM DEMO'],
      ["DATA D'OPERACIÓ", 'CONCEPTE', 'TIPUS DE MOVIMENT', 'IMPORT', 'DIVISA'],
      ['2026-06-29', 'BON AREA', 'Compra', '-60,00', 'EUR'],
      ['2026-06-18', 'BON AREA', 'Compra', '-50,00', 'EUR'],
    ];

    const result = parseBbvaCard(table);
    expect(result.compte).toEqual({ banc: 'bbva', tipus: 'targeta' });
    expect(result.moviments).toHaveLength(2);
    expect(result.moviments[0]).toEqual({
      dataOperacio: '2026-06-29',
      dataValor: '2026-06-29',
      concepteOriginal: 'BON AREA',
      importCents: -6000,
      saldoPosteriorCents: null,
    });
  });

  it('throws when the Catalan header is not present', () => {
    expect(() => parseBbvaCard([['Fecha', 'Concepto', 'Importe']])).toThrow();
  });
});
