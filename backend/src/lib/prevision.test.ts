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
    importAproximat: false,
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

  it('silently fast-forwards a stale dataPrevista to the first future occurrence, without projecting past ones, when the last one was conciliated', () => {
    // dataPrevista left over from months ago (no automatic advance elsewhere in the app);
    // the last past occurrence (2026-06-15) has a matching real movement, so it's resolved silently.
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-06-15', importCents: -5000 }];
    const esdeveniments = projectaEsdeveniments([recurrent({ dataPrevista: '2026-01-15' })], moviments, 30, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15']);
    expect(esdeveniments[0].vençut).toBeUndefined();
  });

  it('flags the most recent unconciliated past occurrence of a periodic recurrent as vençut, without stopping future projection', () => {
    // Same stale dataPrevista, but this time nothing conciliates the 2026-06-15 occurrence.
    const esdeveniments = projectaEsdeveniments([recurrent({ dataPrevista: '2026-01-15' })], [], 30, AVUI);

    expect(esdeveniments).toEqual([
      {
        data: '2026-07-15',
        compteId: 'compte-1',
        concepte: 'CONCEPTE',
        importCents: -5000,
        importAproximat: false,
        recurrentId: 'r1',
        categoriaId: undefined,
        esTransferenciaInterna: undefined,
      },
      {
        data: '2026-07-22',
        compteId: 'compte-1',
        concepte: 'CONCEPTE',
        importCents: -5000,
        importAproximat: false,
        recurrentId: 'r1',
        categoriaId: undefined,
        esTransferenciaInterna: undefined,
        vençut: true,
        dataPrevistaOriginal: '2026-06-15',
      },
    ]);
  });

  it('does not flag anything as vençut for a periodic recurrent whose dataPrevista is not stale', () => {
    const esdeveniments = projectaEsdeveniments([recurrent()], [], 60, AVUI);

    expect(esdeveniments.every((e) => !e.vençut)).toBe(true);
  });

  it('resolves a vençut periodic occurrence against a real movement more than 3 (but at most 30) days after the due date', () => {
    // The occurrence was due 2026-06-15; the real payment arrived 10 days late, well beyond the strict ±3-day window.
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-06-25', importCents: -5000 }];
    const esdeveniments = projectaEsdeveniments([recurrent({ dataPrevista: '2026-01-15' })], moviments, 30, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15']);
    expect(esdeveniments[0].vençut).toBeUndefined();
  });

  it('does not resolve a vençut occurrence against a real movement more than 30 days after the due date', () => {
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-07-20', importCents: -5000 }];
    const esdeveniments = projectaEsdeveniments([recurrent({ dataPrevista: '2026-01-15' })], moviments, 30, AVUI);

    const vencut = esdeveniments.find((e) => e.vençut);
    expect(vencut).toMatchObject({ dataPrevistaOriginal: '2026-06-15' });
  });

  it('does not resolve a vençut occurrence against a real movement before the due date', () => {
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-06-10', importCents: -5000 }];
    const esdeveniments = projectaEsdeveniments([recurrent({ dataPrevista: '2026-01-15' })], moviments, 30, AVUI);

    const vencut = esdeveniments.find((e) => e.vençut);
    expect(vencut).toMatchObject({ dataPrevistaOriginal: '2026-06-15' });
  });

  it('does not resolve a vençut occurrence against an unrelated real movement of merely similar amount when the recurrent is not importAproximat', () => {
    // Regression test: within the 30-day resolution window, an unrelated real movement (different
    // payer/client) whose amount happens to fall within the old ±15% tolerance must NOT resolve an
    // import-cert commitment — only an exact amount counts.
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-06-20', importCents: -5100 }];
    const esdeveniments = projectaEsdeveniments([recurrent({ dataPrevista: '2026-01-15', importAproximat: false })], moviments, 30, AVUI);

    const vencut = esdeveniments.find((e) => e.vençut);
    expect(vencut).toMatchObject({ dataPrevistaOriginal: '2026-06-15' });
  });

  it('skips an occurrence already conciliated by an exact real movement within a few days', () => {
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: -5000 }];

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

  it('requires an exactly matching amount when the recurrent is not importAproximat, even within the old tolerance margin', () => {
    // Regression test for a real false positive: a client-invoice recurrent (import real) was
    // silently conciliated against an unrelated real movement just because the amount fell
    // within ±15% and the date within the resolution window.
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: -5100 }];

    const esdeveniments = projectaEsdeveniments([recurrent({ importAproximat: false })], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15', '2026-08-15']);
  });

  it('conciliates within the tolerance margin when the recurrent is importAproximat', () => {
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: -5100 }];

    const esdeveniments = projectaEsdeveniments([recurrent({ importAproximat: true })], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-08-15']);
  });

  it('does not conciliate when the categoria differs, even with an exact amount and date match', () => {
    const moviments: MovimentPerConciliacio[] = [
      { compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: -5000, categoriaId: 'altra-categoria' },
    ];

    const esdeveniments = projectaEsdeveniments([recurrent({ categoriaId: 'categoria-1' })], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15', '2026-08-15']);
  });

  it('conciliates when the categoria matches on both sides', () => {
    const moviments: MovimentPerConciliacio[] = [
      { compteId: 'compte-1', dataOperacio: '2026-07-14', importCents: -5000, categoriaId: 'categoria-1' },
    ];

    const esdeveniments = projectaEsdeveniments([recurrent({ categoriaId: 'categoria-1' })], moviments, 60, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-08-15']);
  });

  it('projects an overdue unica (not yet conciliated) 10 days after today, flagged as vençut with the original due date', () => {
    const esdeveniments = projectaEsdeveniments(
      [recurrent({ periodicitat: 'unica', dataPrevista: '2026-06-01' })],
      [],
      30,
      AVUI,
    );

    expect(esdeveniments).toEqual([
      {
        data: '2026-07-22',
        compteId: 'compte-1',
        concepte: 'CONCEPTE',
        importCents: -5000,
        importAproximat: false,
        recurrentId: 'r1',
        categoriaId: undefined,
        esTransferenciaInterna: undefined,
        vençut: true,
        dataPrevistaOriginal: '2026-06-01',
      },
    ]);
  });

  it('does not flag a future unica as vençut', () => {
    const esdeveniments = projectaEsdeveniments(
      [recurrent({ periodicitat: 'unica', dataPrevista: '2026-07-20' })],
      [],
      30,
      AVUI,
    );

    expect(esdeveniments[0].vençut).toBeUndefined();
  });

  it('conciliates an overdue unica against the original due date, not against today', () => {
    // The real payment happened on 2026-06-02, close to the original due date (2026-06-01),
    // far from today (2026-07-12) — conciliation must anchor on the original date.
    const moviments: MovimentPerConciliacio[] = [{ compteId: 'compte-1', dataOperacio: '2026-06-02', importCents: -5000 }];

    const esdeveniments = projectaEsdeveniments(
      [recurrent({ periodicitat: 'unica', dataPrevista: '2026-06-01' })],
      moviments,
      30,
      AVUI,
    );

    expect(esdeveniments).toEqual([]);
  });

  it('does not clamp an overdue unica past its own dataFi', () => {
    const esdeveniments = projectaEsdeveniments(
      [recurrent({ periodicitat: 'unica', dataPrevista: '2026-06-01', dataFi: '2026-06-05' })],
      [],
      30,
      AVUI,
    );

    expect(esdeveniments).toEqual([]);
  });

  it('does not show an overdue unica whose dataFi falls between today and the 10-day displaced date', () => {
    // AVUI=2026-07-12, displaced date would be 2026-07-22, but dataFi=2026-07-15 has already passed by then.
    const esdeveniments = projectaEsdeveniments(
      [recurrent({ periodicitat: 'unica', dataPrevista: '2026-06-01', dataFi: '2026-07-15' })],
      [],
      30,
      AVUI,
    );

    expect(esdeveniments).toEqual([]);
  });

  it('stops projecting past dataFi', () => {
    const esdeveniments = projectaEsdeveniments([recurrent({ dataFi: '2026-07-15' })], [], 90, AVUI);

    expect(esdeveniments.map((e) => e.data)).toEqual(['2026-07-15']);
  });

  it('propagates esTransferenciaInterna from the recurrent to the projected event', () => {
    const [marcat] = projectaEsdeveniments([recurrent({ esTransferenciaInterna: true })], [], 30, AVUI);
    expect(marcat.esTransferenciaInterna).toBe(true);

    const [noMarcat] = projectaEsdeveniments([recurrent()], [], 30, AVUI);
    expect(noMarcat.esTransferenciaInterna).toBeUndefined();
  });

  it('propagates importAproximat from the recurrent to the projected event, including a vençut one', () => {
    const [aproximat] = projectaEsdeveniments([recurrent({ importAproximat: true })], [], 30, AVUI);
    expect(aproximat.importAproximat).toBe(true);

    const [cert] = projectaEsdeveniments([recurrent({ importAproximat: false })], [], 30, AVUI);
    expect(cert.importAproximat).toBe(false);

    const [vençut] = projectaEsdeveniments(
      [recurrent({ periodicitat: 'unica', dataPrevista: '2026-06-01', importAproximat: true })],
      [],
      30,
      AVUI,
    );
    expect(vençut.vençut).toBe(true);
    expect(vençut.importAproximat).toBe(true);
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

  it('counts horitzoDies from avuiReal, not from the (possibly earlier) anchor avui', () => {
    const anticAncora = '2026-06-01';
    const avuiReal = '2026-07-12';
    // A 25 dies vista d'avui de veritat, però a més de 30 dies de l'àncora
    // (que és d'un mes abans): amb un horitzó de 30 dies comptat des de
    // l'àncora quedaria fora; comptat des d'avuiReal (com ha de ser), hi cau.
    const propAvuiReal = recurrent({ periodicitat: 'unica', dataPrevista: '2026-08-06' });

    const ambAvuiReal = projectaEsdeveniments([propAvuiReal], [], 30, anticAncora, undefined, avuiReal);
    expect(ambAvuiReal.map((e) => e.data)).toEqual(['2026-08-06']);

    const senseAvuiReal = projectaEsdeveniments([propAvuiReal], [], 30, anticAncora);
    expect(senseAvuiReal).toEqual([]);
  });
});

describe('construeixSerieDiaria', () => {
  it('carries the initial balance forward and accumulates events on their date', () => {
    const esdeveniments: EsdevenimentPrevist[] = [
      { data: '2026-07-14', compteId: 'compte-1', concepte: 'A', importCents: -1000, importAproximat: false, recurrentId: 'r1' },
      { data: '2026-07-16', compteId: 'compte-1', concepte: 'B', importCents: 500, importAproximat: false, recurrentId: 'r2' },
    ];

    const serie = construeixSerieDiaria({ 'compte-1': 10000 }, esdeveniments, 5, AVUI);

    expect(serie.map((p) => p.saldoTotal)).toEqual([10000, 10000, 9000, 9000, 9500, 9500]);
    expect(serie[0].data).toBe(AVUI);
    expect(serie.at(-1)?.data).toBe('2026-07-17');
  });

  it('sums across multiple accounts for saldoTotal while keeping saldoPerCompte separate', () => {
    const esdeveniments: EsdevenimentPrevist[] = [
      { data: '2026-07-13', compteId: 'compte-2', concepte: 'A', importCents: -2000, importAproximat: false, recurrentId: 'r1' },
    ];

    const serie = construeixSerieDiaria({ 'compte-1': 1000, 'compte-2': 5000 }, esdeveniments, 3, AVUI);

    expect(serie[1]).toMatchObject({ data: '2026-07-13', saldoTotal: 4000, saldoPerCompte: { 'compte-1': 1000, 'compte-2': 3000 } });
  });
});
