import { describe, expect, it } from 'vitest';
import { detectaRecurrents, type MovimentCandidat } from './recurrenceDetection';

let seq = 0;
function mov(overrides: Partial<MovimentCandidat> = {}): MovimentCandidat {
  seq++;
  return {
    id: `m${seq}`,
    compteId: 'compte-1',
    dataOperacio: '2026-01-01',
    concepteOriginal: 'CONCEPTE',
    importCents: -1000,
    ...overrides,
  };
}

describe('detectaRecurrents', () => {
  it('detects a monthly salary (nòmina): same amount, same day of month, positive sign', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-30', concepteOriginal: 'NOMINA EMPRESA SL', importCents: 180000 }),
      mov({ dataOperacio: '2026-02-27', concepteOriginal: 'NOMINA EMPRESA SL', importCents: 180000 }),
      mov({ dataOperacio: '2026-03-30', concepteOriginal: 'NOMINA EMPRESA SL', importCents: 180000 }),
      mov({ dataOperacio: '2026-04-30', concepteOriginal: 'NOMINA EMPRESA SL', importCents: 180000 }),
    ];

    const [candidat] = detectaRecurrents(moviments);

    expect(candidat).toMatchObject({
      compteId: 'compte-1',
      periodicitat: 'mensual',
      importEstimatCents: 180000,
      importMinCents: 180000,
      importMaxCents: 180000,
      ocurrencies: 4,
    });
    expect(candidat.dataPrevista).toBe('2026-05-30');
    expect(candidat.confianca).toBeGreaterThan(50);
  });

  it('detects a monthly rent/mortgage (negative sign)', () => {
    const moviments = ['2026-01-03', '2026-02-03', '2026-03-03', '2026-04-03'].map((data) =>
      mov({ dataOperacio: data, concepteOriginal: 'REBUT LLOGUER PIS', importCents: -85000 }),
    );

    const [candidat] = detectaRecurrents(moviments);

    expect(candidat.periodicitat).toBe('mensual');
    expect(candidat.importEstimatCents).toBe(-85000);
  });

  it('detects a variable monthly utility bill within the ±15% amount tolerance, using the median as the estimate', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4500 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'RECIBO ENDESA', importCents: -5000 }),
      mov({ dataOperacio: '2026-03-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4800 }),
      mov({ dataOperacio: '2026-04-05', concepteOriginal: 'RECIBO ENDESA', importCents: -5200 }),
    ];

    const [candidat] = detectaRecurrents(moviments);

    expect(candidat.periodicitat).toBe('mensual');
    expect(candidat.importMinCents).toBe(-5200);
    expect(candidat.importMaxCents).toBe(-4500);
    expect(candidat.ocurrencies).toBe(4);
  });

  it('groups occurrences whose concept only differs by a variable reference number (spec 4.1.1)', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'RECIBO ENDESA REF 0012345', importCents: -4500 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'RECIBO ENDESA REF 0012399', importCents: -4500 }),
      mov({ dataOperacio: '2026-03-05', concepteOriginal: 'RECIBO ENDESA REF 0099001', importCents: -4500 }),
    ];

    const candidats = detectaRecurrents(moviments);

    expect(candidats).toHaveLength(1);
    expect(candidats[0].ocurrencies).toBe(3);
  });

  it('detects a weekly pattern', () => {
    const moviments = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((data) =>
      mov({ dataOperacio: data, concepteOriginal: 'SUBSCRIPCIO SETMANAL', importCents: -500 }),
    );

    const [candidat] = detectaRecurrents(moviments);

    expect(candidat.periodicitat).toBe('setmanal');
    expect(candidat.dataPrevista).toBe('2026-02-02');
  });

  it('detects an annual pattern with only 2 occurrences (lower minimum than shorter periodicities)', () => {
    const moviments = [
      mov({ dataOperacio: '2025-06-01', concepteOriginal: 'ASSEGURANCA COTXE', importCents: -32000 }),
      mov({ dataOperacio: '2026-06-01', concepteOriginal: 'ASSEGURANCA COTXE', importCents: -32000 }),
    ];

    const [candidat] = detectaRecurrents(moviments);

    expect(candidat.periodicitat).toBe('anual');
    expect(candidat.dataPrevista).toBe('2027-06-01');
  });

  it('does not surface a monthly-looking pattern with fewer than 3 occurrences', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4500 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4500 }),
    ];

    expect(detectaRecurrents(moviments)).toEqual([]);
  });

  it('excludes an outlier amount from the pattern (one-off unrelated charge with the same concept)', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4500 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4800 }),
      mov({ dataOperacio: '2026-02-20', concepteOriginal: 'RECIBO ENDESA', importCents: -99900 }), // outlier, way outside ±15%
      mov({ dataOperacio: '2026-03-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4600 }),
    ];

    const [candidat] = detectaRecurrents(moviments);

    expect(candidat.ocurrencies).toBe(3);
    expect(candidat.importMaxCents).toBe(-4500);
    expect(candidat.movimentIds).not.toContain(moviments[2].id);
  });

  it('does not detect a pattern when intervals are irregular and match no known periodicity', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-01', concepteOriginal: 'MERCADONA', importCents: -3000 }),
      mov({ dataOperacio: '2026-01-04', concepteOriginal: 'MERCADONA', importCents: -3000 }),
      mov({ dataOperacio: '2026-03-20', concepteOriginal: 'MERCADONA', importCents: -3000 }),
    ];

    expect(detectaRecurrents(moviments)).toEqual([]);
  });

  it('keeps the same recurring concept on different accounts as separate candidates', () => {
    const moviments = [
      ...['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => mov({ compteId: 'compte-A', dataOperacio: data, concepteOriginal: 'NETFLIX', importCents: -1200 })),
      ...['2026-01-10', '2026-02-10', '2026-03-10'].map((data) => mov({ compteId: 'compte-B', dataOperacio: data, concepteOriginal: 'NETFLIX', importCents: -1200 })),
    ];

    const candidats = detectaRecurrents(moviments);

    expect(candidats).toHaveLength(2);
    expect(new Set(candidats.map((c) => c.compteId))).toEqual(new Set(['compte-A', 'compte-B']));
  });

  it('does not mix an income and an expense sharing the same concept text into one pattern', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'AJUST SALDO', importCents: 1000 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'AJUST SALDO', importCents: 1000 }),
      mov({ dataOperacio: '2026-03-05', concepteOriginal: 'AJUST SALDO', importCents: 1000 }),
      mov({ dataOperacio: '2026-01-06', concepteOriginal: 'AJUST SALDO', importCents: -1000 }),
      mov({ dataOperacio: '2026-02-06', concepteOriginal: 'AJUST SALDO', importCents: -1000 }),
      mov({ dataOperacio: '2026-03-06', concepteOriginal: 'AJUST SALDO', importCents: -1000 }),
    ];

    const candidats = detectaRecurrents(moviments);

    expect(candidats).toHaveLength(2);
    expect(new Set(candidats.map((c) => Math.sign(c.importEstimatCents)))).toEqual(new Set([1, -1]));
  });

  it('ignores zero-amount movements', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'AJUST', importCents: 0 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'AJUST', importCents: 0 }),
      mov({ dataOperacio: '2026-03-05', concepteOriginal: 'AJUST', importCents: 0 }),
    ];

    expect(detectaRecurrents(moviments)).toEqual([]);
  });

  it('clamps the predicted next date to the last day of the target month (month-end rollover)', () => {
    const moviments = ['2025-11-30', '2025-12-31', '2026-01-31'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'LLOGUER', importCents: -85000 }));

    const [candidat] = detectaRecurrents(moviments);

    expect(candidat.periodicitat).toBe('mensual');
    expect(candidat.dataPrevista).toBe('2026-02-28');
  });

  it('returns candidates sorted by predicted next date', () => {
    const proper = ['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'A PRIMER', importCents: -1000 }));
    const posterior = ['2026-01-20', '2026-02-20', '2026-03-20'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'B SEGON', importCents: -2000 }));

    const candidats = detectaRecurrents([...posterior, ...proper]);

    expect(candidats.map((c) => c.concepte)).toEqual(['A PRIMER', 'B SEGON']);
  });
});
