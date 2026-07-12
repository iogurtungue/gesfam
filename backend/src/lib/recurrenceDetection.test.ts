import { describe, expect, it } from 'vitest';
import { detectaRecurrents, estimaLiquidacioTargeta, type MovimentCandidat, type MovimentTargetaCandidat } from './recurrenceDetection';

// Anterior a totes les dates de moviments usades en aquest fitxer, perquè cap
// test es vegi afectat per la projecció cap al futur (properaOcurrencia):
// sense fixar "avui", el paràmetre per defecte és la data real del sistema,
// que faria que un dataPrevista calculat per a un 2026 ja passat s'avancés
// fins avui de veritat, trencant les assercions fixes d'aquests tests.
const AVUI = '2000-01-01';

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

    const [candidat] = detectaRecurrents(moviments, AVUI);

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

    const [candidat] = detectaRecurrents(moviments, AVUI);

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

    const [candidat] = detectaRecurrents(moviments, AVUI);

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

    const candidats = detectaRecurrents(moviments, AVUI);

    expect(candidats).toHaveLength(1);
    expect(candidats[0].ocurrencies).toBe(3);
  });

  it('detects a weekly pattern', () => {
    const moviments = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((data) =>
      mov({ dataOperacio: data, concepteOriginal: 'SUBSCRIPCIO SETMANAL', importCents: -500 }),
    );

    const [candidat] = detectaRecurrents(moviments, AVUI);

    expect(candidat.periodicitat).toBe('setmanal');
    expect(candidat.dataPrevista).toBe('2026-02-02');
  });

  it('detects an annual pattern with only 2 occurrences (lower minimum than shorter periodicities)', () => {
    const moviments = [
      mov({ dataOperacio: '2025-06-01', concepteOriginal: 'ASSEGURANCA COTXE', importCents: -32000 }),
      mov({ dataOperacio: '2026-06-01', concepteOriginal: 'ASSEGURANCA COTXE', importCents: -32000 }),
    ];

    const [candidat] = detectaRecurrents(moviments, AVUI);

    expect(candidat.periodicitat).toBe('anual');
    expect(candidat.dataPrevista).toBe('2027-06-01');
  });

  it('does not surface a monthly-looking pattern with fewer than 3 occurrences', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4500 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4500 }),
    ];

    expect(detectaRecurrents(moviments, AVUI)).toEqual([]);
  });

  it('excludes an outlier amount from the pattern (one-off unrelated charge with the same concept)', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4500 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4800 }),
      mov({ dataOperacio: '2026-02-20', concepteOriginal: 'RECIBO ENDESA', importCents: -99900 }), // outlier, way outside ±15%
      mov({ dataOperacio: '2026-03-05', concepteOriginal: 'RECIBO ENDESA', importCents: -4600 }),
    ];

    const [candidat] = detectaRecurrents(moviments, AVUI);

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

    expect(detectaRecurrents(moviments, AVUI)).toEqual([]);
  });

  it('keeps the same recurring concept on different accounts as separate candidates', () => {
    const moviments = [
      ...['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => mov({ compteId: 'compte-A', dataOperacio: data, concepteOriginal: 'NETFLIX', importCents: -1200 })),
      ...['2026-01-10', '2026-02-10', '2026-03-10'].map((data) => mov({ compteId: 'compte-B', dataOperacio: data, concepteOriginal: 'NETFLIX', importCents: -1200 })),
    ];

    const candidats = detectaRecurrents(moviments, AVUI);

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

    const candidats = detectaRecurrents(moviments, AVUI);

    expect(candidats).toHaveLength(2);
    expect(new Set(candidats.map((c) => Math.sign(c.importEstimatCents)))).toEqual(new Set([1, -1]));
  });

  it('ignores zero-amount movements', () => {
    const moviments = [
      mov({ dataOperacio: '2026-01-05', concepteOriginal: 'AJUST', importCents: 0 }),
      mov({ dataOperacio: '2026-02-05', concepteOriginal: 'AJUST', importCents: 0 }),
      mov({ dataOperacio: '2026-03-05', concepteOriginal: 'AJUST', importCents: 0 }),
    ];

    expect(detectaRecurrents(moviments, AVUI)).toEqual([]);
  });

  it('clamps the predicted next date to the last day of the target month (month-end rollover)', () => {
    const moviments = ['2025-11-30', '2025-12-31', '2026-01-31'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'LLOGUER', importCents: -85000 }));

    const [candidat] = detectaRecurrents(moviments, AVUI);

    expect(candidat.periodicitat).toBe('mensual');
    expect(candidat.dataPrevista).toBe('2026-02-28');
  });

  it('returns candidates sorted by predicted next date', () => {
    const proper = ['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'A PRIMER', importCents: -1000 }));
    const posterior = ['2026-01-20', '2026-02-20', '2026-03-20'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'B SEGON', importCents: -2000 }));

    const candidats = detectaRecurrents([...posterior, ...proper], AVUI);

    expect(candidats.map((c) => c.concepte)).toEqual(['A PRIMER', 'B SEGON']);
  });

  describe('properaOcurrencia (bug: un candidat mostrava una data passada com a "propera")', () => {
    it('projecta la data prevista cap endavant fins que no quedi en el passat, quan fa mesos que no arriben moviments nous', () => {
      const moviments = ['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'NETFLIX', importCents: -1200 }));

      // Sense correcció, la propera data seria 2026-04-05 (últim + 1 mes) — ja passada respecte a aquest "avui".
      const [candidat] = detectaRecurrents(moviments, '2026-07-12');

      expect(candidat.dataPrevista).toBe('2026-08-05');
      expect(candidat.dataPrevista >= '2026-07-12').toBe(true);
    });

    it('avança tants períodes com calgui, no només un (patró setmanal amb mesos sense moviments nous)', () => {
      const moviments = ['2026-01-05', '2026-01-12', '2026-01-19'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'SUBSCRIPCIO', importCents: -500 }));

      const [candidat] = detectaRecurrents(moviments, '2026-03-01');

      // Últim 2026-01-19 + 1 setmana = 01-26 (passada), calen 6 salts de 7 dies per superar 03-01.
      expect(candidat.dataPrevista).toBe('2026-03-02');
    });

    it('no toca la data prevista quan encara és avui o futura', () => {
      const moviments = ['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => mov({ dataOperacio: data, concepteOriginal: 'NETFLIX', importCents: -1200 }));

      const [candidat] = detectaRecurrents(moviments, '2026-03-06');

      expect(candidat.dataPrevista).toBe('2026-04-05');
    });

    it('sense indicar "avui", fa servir la data real i mai retorna una dataPrevista passada', () => {
      // Dia 1 de cada mes per evitar el desbordament de setMonth quan un mes
      // no té prou dies (p. ex. 31/01 + 1 mes -> 03/03, no 28/02) — no és
      // rellevant per aquest test, que només vol comprovar el valor per
      // defecte d'"avui" amb dates sempre vàlides.
      const ara = new Date();
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const moviments = [-3, -2, -1].map((desplacamentMesos) =>
        mov({
          dataOperacio: iso(new Date(ara.getFullYear(), ara.getMonth() + desplacamentMesos, 1)),
          concepteOriginal: 'GIMNÀS',
          importCents: -3000,
        }),
      );

      const [candidat] = detectaRecurrents(moviments);

      expect(candidat.dataPrevista >= iso(ara)).toBe(true);
    });
  });
});

describe('estimaLiquidacioTargeta (sub-fase 3.5 revisada, especificacio.md 3.2.1)', () => {
  function mt(dataOperacio: string, importCents: number, id = dataOperacio): MovimentTargetaCandidat {
    return { id, dataOperacio, importCents };
  }

  it('averages up to 3 complete cycles, using the median as the estimate', () => {
    const moviments = [mt('2026-04-10', -12000, 'a'), mt('2026-05-15', -8000, 'b'), mt('2026-06-20', -10000, 'c')];

    const estimacio = estimaLiquidacioTargeta(moviments, 5, '2026-07-12');

    expect(estimacio).toMatchObject({
      importEstimatCents: -10000,
      importMinCents: -12000,
      importMaxCents: -8000,
      periodesUsats: 3,
      confianca: 100,
      dataPrevista: '2026-08-05',
    });
  });

  it('returns an estimate with just the minimum of 2 periods of data', () => {
    const moviments = [mt('2026-05-15', -8000, 'a'), mt('2026-06-20', -10000, 'b')];

    const estimacio = estimaLiquidacioTargeta(moviments, 5, '2026-07-12');

    expect(estimacio).toMatchObject({ importEstimatCents: -9000, periodesUsats: 2, confianca: 67 });
  });

  it('returns null when fewer than 2 complete cycles have any data', () => {
    const moviments = [mt('2026-06-20', -10000)];

    expect(estimaLiquidacioTargeta(moviments, 5, '2026-07-12')).toBeNull();
  });

  it('returns null with no movements at all', () => {
    expect(estimaLiquidacioTargeta([], 5, '2026-07-12')).toBeNull();
  });

  it('assigns a boundary-dated movement to the correct cycle (inclusive on both ends)', () => {
    const moviments = [
      mt('2026-06-05', -1000, 'finalPeriode1'), // últim dia del cicle anterior
      mt('2026-06-06', -2000, 'primerPeriode0'), // primer dia del cicle actual
      mt('2026-04-20', -3000, 'periode2'),
    ];

    const estimacio = estimaLiquidacioTargeta(moviments, 5, '2026-07-12')!;

    expect(estimacio.periodesUsats).toBe(3);
    expect([...estimacio.movimentIds].sort()).toEqual(['finalPeriode1', 'periode2', 'primerPeriode0'].sort());
    // Totals per cicle: -2000 (actual), -1000 (anterior), -3000 (fa dos cicles) -> mediana = -2000.
    expect(estimacio.importEstimatCents).toBe(-2000);
  });

  it('sums signed amounts within a cycle (a refund reduces the total)', () => {
    const moviments = [mt('2026-06-10', -10000, 'a'), mt('2026-06-15', 3000, 'devolucio'), mt('2026-05-10', -8000, 'c')];

    const estimacio = estimaLiquidacioTargeta(moviments, 5, '2026-07-12')!;

    // Cicle actual: -10000+3000=-7000; cicle anterior: -8000. Mediana (2 valors) = -7500.
    expect(estimacio.periodesUsats).toBe(2);
    expect(estimacio.importEstimatCents).toBe(-7500);
  });

  it('clamps the settlement day to the last day of shorter months when building cycle boundaries', () => {
    const moviments = [mt('2026-02-15', -5000, 'a'), mt('2026-01-15', -4000, 'b')];

    const estimacio = estimaLiquidacioTargeta(moviments, 31, '2026-03-15')!;

    expect(estimacio.periodesUsats).toBe(2);
    expect(estimacio.dataPrevista).toBe('2026-03-31');
  });

  it('without specifying avui, uses the real date and always returns a future dataPrevista', () => {
    const ara = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const moviments = [
      mt(iso(new Date(ara.getFullYear(), ara.getMonth() - 2, 10)), -5000, 'a'),
      mt(iso(new Date(ara.getFullYear(), ara.getMonth() - 1, 10)), -6000, 'b'),
    ];

    const estimacio = estimaLiquidacioTargeta(moviments, 15);

    expect(estimacio).not.toBeNull();
    expect(estimacio!.dataPrevista >= iso(ara)).toBe(true);
  });
});
