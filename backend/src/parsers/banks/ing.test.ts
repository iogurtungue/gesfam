import { describe, expect, it } from 'vitest';
import type { RawTable } from '../types';
import { parseIngAccount, parseIngCard } from './ing';

describe('parseIngAccount', () => {
  it('extracts movements below a preamble, using real numeric/date cells when present', () => {
    const table: RawTable = [
      ['Movimientos de la Cuenta', '', '', '', '', '', ''],
      ['', '', 'Número de cuenta:', '1234 5678 90', '', '', ''],
      ['F. VALOR', 'CATEGORÍA', 'SUBCATEGORÍA', 'DESCRIPCIÓN', 'COMENTARIO', 'IMPORTE (€)', 'SALDO (€)'],
      [new Date(2026, 6, 6), 'Otros ingresos', 'Ingresos', 'Transferencia recibida', '', 763.44, 1052.79],
      ['', '', '', '', '', '', ''],
      ['05/07/2026', 'Hogar', 'Teléfono', 'Recibo GURBTEC', '', -42.35, 289.35],
    ];

    const result = parseIngAccount(table);
    expect(result.compte).toEqual({ banc: 'ing', tipus: 'corrent', numeroCompte: '1234567890' });
    expect(result.warnings).toEqual([]);
    expect(result.moviments).toHaveLength(2);
    expect(result.moviments[0]).toEqual({
      dataOperacio: '2026-07-06',
      dataValor: '2026-07-06',
      concepteOriginal: 'Transferencia recibida',
      importCents: 76344,
      saldoPosteriorCents: 105279,
    });
    expect(result.moviments[1].importCents).toBe(-4235);
  });

  it('throws when no recognisable header is found', () => {
    expect(() => parseIngAccount([['a', 'b'], ['c', 'd']])).toThrow();
  });
});

describe('parseIngCard', () => {
  it('extracts card movements with no saldo column', () => {
    const table: RawTable = [
      ['Tarjeta Crédito', 'Número de tarjeta:', '5160 **** **** 3022'],
      ['FECHA VALOR', 'CATEGORÍA', 'SUBCATEGORÍA', 'DESCRIPCION', 'COMENTARIO', '', 'ESTADO', 'IMPORTE (€)'],
      ['05/07/2026', 'Compras', 'Compras (otros)', 'NYX*Independent', '', '', 'Pendiente de liquidar', '-1,50'],
    ];

    const result = parseIngCard(table);
    expect(result.compte).toEqual({ banc: 'ing', tipus: 'targeta', numeroCompte: '5160********3022' });
    expect(result.moviments).toHaveLength(1);
    expect(result.moviments[0].saldoPosteriorCents).toBeNull();
    expect(result.moviments[0].importCents).toBe(-150);
  });
});
