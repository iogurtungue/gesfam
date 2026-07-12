import { describe, expect, it } from 'vitest';
import {
  construeixSerieDiaria,
  projectaEsdeveniments,
  type EsdevenimentPrevist,
  type MovimentPerConciliacio,
  type RecurrentPerProjeccio,
} from './prevision';

const AVUI = '2026-07-12';

function recurrent(overrides: Partial<RecurrentPerProjeccio> = {}): RecurrentPerProjeccio {
  return {
    id: 'r1',
    compteId: 'compte-1',
    concepte: 'CONCEPTE',
    periodicitat: 'mensual',
    importCents: -5000,
    dataPrevista: '2026-07-15',
    ...overrides,
  };
}

describe('projectaEsdeveniments', () => {
  it('projects every occurrence of a monthly recurrent within the horizon', () => {
    const esdeveniments = projectaEsdeveniments([recurrent()], [], 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15', '2026-08-15']);
    expect(esdeveniments[0]).toMatchObject({ compteId: 'compte-1', concepte: 'CONCEPTE', importCents: -5000, recurrentId: 'r1' });
  });

  it('projects a punctual (unica) commitment only once, never repeating it', () => {
    const esdeveniments = projectaEsdeveniments(
      [recurrent({ periodicitat: 'unica', dataPrevista: '2026-07-20' })],
      [],
      90,
      AVUI,
    );

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-20']);
  });

  it('silently fast-forwards a stale dataPrevista to the first future occurrence, without projecting past ones', () => {
    // dataPrevista left over from months ago (no automatic advance elsewhere in the app).
    const esdeveniments = projectaEsdeveniments([recurrent({ dataPrevista: '2026-01-15' })], [], 30, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15']);
  });

  it('skips an occurrence already conciliated by a similar real movement within a few days', () => {
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: -5100 }];

    const esdeveniments = projectaEsdeveniments([recurrent()], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-08-15']);
  });

  it('does not conciliate against a real movement too far away in date', () => {
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-07-01', importCents: -5000 }];

    const esdeveniments = projectaEsdeveniments([recurrent()], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15', '2026-08-15']);
  });

  it('does not conciliate against a real movement whose amount differs too much', () => {
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: -9000 }];

    const esdeveniments = projectaEsdeveniments([recurrent()], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15', '2026-08-15']);
  });

  it('does not conciliate against a movement of a different account or opposite sign', () => {
    const moviments: MovimentPerConciliacio[] = [
      { compteId: 'compte-2', dataOperacio: '2026-07-14', importCents: -5000 },
      { compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: 5000 },
    ];

    const esdeveniments = projectaEsdeveniments([recurrent()], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15', '2026-08-15']);
  });

  it('stops projecting past dataFi', () => {
    const esdeveniments = projectaEsdeveniments([recurrent({ dataFi: '2026-07-15' })], [], 90, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15']);
  });

  it('sorts events chronologically across multiple recurrents', () => {
    const esdeveniments = projectaEsdeveniments(
      [
        recurrent({ id: 'r2', dataPrevista: '2026-07-25' }),
        recurrent({ id: 'r1', dataPrevista: '2026-07-15' }),
      ],
      [],
      20,
      AVUI,
    );

    expect(esdeveniments.map((e) => e.recurrentId)).toEqual(['r1', 'r2']);
  });
});

describe('construeixSerieDiaria', () => {
  it('carries the initial balance forward and accumulates events on their date', () => {
    const esdeveniments: EsdevenimentPrevist[] = [
      { data: '2026-07-14', compteId: 'compte-1', concepte: 'A', importCents: -1000, recurrentId: 'r1' },
      { data: '2026-07-16', compteId: 'compte-1', concepte: 'B', importCents: 500, recurrentId: 'r2' },
    ];

    const serie = construeixSerieDiaria({ 'compte-1': 10000 }, esdeveniments, 5, AVUI);

    expect(serie.map((p) => p.saldoTotal)).toEqual([10000, 10000, 9000, 9000, 9500, 9500]);
    expect(serie[0].data).toBe(AVUI);
    expect(serie.at(-1)?.data).toBe('2026-07-17');
  });

  it('sums across multiple accounts for saldoTotal while keeping saldoPerCompte separate', () => {
    const esdeveniments: EsdevenimentPrevist[] = [
      { data: '2026-07-13', compteId: 'compte-2', concepte: 'A', importCents: -2000, recurrentId: 'r1' },
    ];

    const serie = construeixSerieDiaria({ 'compte-1': 1000, 'compte-2': 5000 }, esdeveniments, 3, AVUI);

    expect(serie[1]).toMatchObject({ data: '2026-07-13', saldoTotal: 4000, saldoPerCompte: { 'compte-1': 1000, 'compte-2': 3000 } });
  });
});
