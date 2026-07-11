import { describe, expect, it } from 'vitest';
import { creaConsultaSaldo, creaSaldoAcumulatPerMoviment, saldoEnData } from './balance';

describe('saldoEnData', () => {
  it('returns the running balance of the latest movement on or before the date (compte corrent)', () => {
    const moviments = [
      { dataOperacio: '2026-06-01', importCents: -1000, saldoPosteriorCents: 9000, seq: 0 },
      { dataOperacio: '2026-06-05', importCents: 500, saldoPosteriorCents: 9500, seq: 1 },
      { dataOperacio: '2026-06-10', importCents: -200, saldoPosteriorCents: 9300, seq: 2 },
    ];
    expect(saldoEnData(moviments, 'corrent', '2026-06-05')).toBe(9500);
    expect(saldoEnData(moviments, 'corrent', '2026-06-07')).toBe(9500);
    expect(saldoEnData(moviments, 'corrent', '2026-06-10')).toBe(9300);
  });

  it('returns null when there is no movement on or before the date', () => {
    const moviments = [{ dataOperacio: '2026-06-10', importCents: -200, saldoPosteriorCents: 9300, seq: 0 }];
    expect(saldoEnData(moviments, 'corrent', '2026-06-01')).toBeNull();
  });

  it('falls back through movements without a known balance to find the last known one', () => {
    const moviments = [
      { dataOperacio: '2026-06-01', importCents: -1000, saldoPosteriorCents: 9000, seq: 0 },
      { dataOperacio: '2026-06-05', importCents: 500, saldoPosteriorCents: null, seq: 1 },
    ];
    expect(saldoEnData(moviments, 'corrent', '2026-06-05')).toBe(9000);
  });

  it('sums accumulated debt for targeta accounts instead of using saldoPosteriorCents', () => {
    const moviments = [
      { dataOperacio: '2026-06-01', importCents: -1000, saldoPosteriorCents: null, seq: 0 },
      { dataOperacio: '2026-06-05', importCents: -500, saldoPosteriorCents: null, seq: 1 },
      { dataOperacio: '2026-06-10', importCents: -200, saldoPosteriorCents: null, seq: 2 },
    ];
    expect(saldoEnData(moviments, 'targeta', '2026-06-05')).toBe(-1500);
    expect(saldoEnData(moviments, 'targeta', '2026-06-10')).toBe(-1700);
  });

  it('falls back to seq when the same-day movements have no reconstructible chain', () => {
    // Deliberately incoherent saldoPosteriorCents/importCents (no valid chain
    // exists between them), so the only ordering signal left is seq.
    const moviments = [
      { dataOperacio: '2026-06-05', importCents: -500, saldoPosteriorCents: 8500, seq: 5 },
      { dataOperacio: '2026-06-05', importCents: 1000, saldoPosteriorCents: 9500, seq: 3 },
      { dataOperacio: '2026-06-05', importCents: -200, saldoPosteriorCents: 9800, seq: 4 },
    ];
    // In seq order (3, 4, 5) the last movement of the day left the balance at 8500.
    expect(saldoEnData(moviments, 'corrent', '2026-06-05')).toBe(8500);
  });

  it('reconstructs the true same-day order from the balance chain, ignoring a scrambled seq (the actual reported bug)', () => {
    // Real scenario: movements imported before `seq` existed got a
    // best-effort backfilled seq that does NOT reflect true file order for
    // same-day movements from the same import batch. The true chronological
    // order here is A (1000 -> 900) -> B (900 -> 700) -> C (700 -> 750), but
    // seq is scrambled as if the migration guessed wrong.
    const A = { dataOperacio: '2026-06-05', importCents: -100, saldoPosteriorCents: 900, seq: 7 };
    const B = { dataOperacio: '2026-06-05', importCents: -200, saldoPosteriorCents: 700, seq: 3 };
    const C = { dataOperacio: '2026-06-05', importCents: 50, saldoPosteriorCents: 750, seq: 5 };
    const previousDay = { dataOperacio: '2026-06-01', importCents: 0, saldoPosteriorCents: 1000, seq: 0 };

    // However the caller happens to pass them in, the true last balance of the day is C's: 750.
    expect(saldoEnData([previousDay, A, B, C], 'corrent', '2026-06-05')).toBe(750);
    expect(saldoEnData([C, B, A, previousDay], 'corrent', '2026-06-05')).toBe(750);
    expect(saldoEnData([B, previousDay, C, A], 'corrent', '2026-06-05')).toBe(750);
  });

  it('anchors the first movement of a day to the previous day\'s closing balance, not just seq', () => {
    // Day 1 closes at 1000. Day 2 has two movements whose seq is reversed
    // relative to their true chain order (D true-first: 1000 -> 1100, E
    // true-second: 1100 -> 1050).
    const day1 = { dataOperacio: '2026-06-01', importCents: 1000, saldoPosteriorCents: 1000, seq: 0 };
    const D = { dataOperacio: '2026-06-02', importCents: 100, saldoPosteriorCents: 1100, seq: 9 };
    const E = { dataOperacio: '2026-06-02', importCents: -50, saldoPosteriorCents: 1050, seq: 2 };

    expect(saldoEnData([day1, D, E], 'corrent', '2026-06-02')).toBe(1050);
  });
});

describe('creaConsultaSaldo', () => {
  it('agrees with saldoEnData across many dates for a compte corrent, including dates without a movement (carry-forward)', () => {
    const moviments = [
      { dataOperacio: '2026-06-01', importCents: -1000, saldoPosteriorCents: 9000, seq: 0 },
      { dataOperacio: '2026-06-05', importCents: 500, saldoPosteriorCents: 9500, seq: 1 },
      { dataOperacio: '2026-06-10', importCents: -200, saldoPosteriorCents: 9300, seq: 2 },
    ];
    const consulta = creaConsultaSaldo(moviments, 'corrent');
    for (const data of ['2026-05-31', '2026-06-01', '2026-06-03', '2026-06-05', '2026-06-07', '2026-06-10', '2026-06-20']) {
      expect(consulta(data)).toBe(saldoEnData(moviments, 'corrent', data));
    }
  });

  it('agrees with saldoEnData for a targeta account (accumulated debt), including a date with no charge that day', () => {
    const moviments = [
      { dataOperacio: '2026-06-01', importCents: -1000, saldoPosteriorCents: null, seq: 0 },
      { dataOperacio: '2026-06-05', importCents: -500, saldoPosteriorCents: null, seq: 1 },
      { dataOperacio: '2026-06-10', importCents: -200, saldoPosteriorCents: null, seq: 2 },
    ];
    const consulta = creaConsultaSaldo(moviments, 'targeta');
    for (const data of ['2026-05-31', '2026-06-01', '2026-06-07', '2026-06-10']) {
      expect(consulta(data)).toBe(saldoEnData(moviments, 'targeta', data));
    }
  });

  it('returns null for an account with no movements at all', () => {
    expect(creaConsultaSaldo([], 'corrent')('2026-06-01')).toBeNull();
  });
});

describe('creaSaldoAcumulatPerMoviment', () => {
  it('accumulates debt chronologically and keys the result by movement id', () => {
    const moviments = [
      { id: 'a', dataOperacio: '2026-06-01', importCents: -1000, saldoPosteriorCents: null, seq: 0 },
      { id: 'b', dataOperacio: '2026-06-05', importCents: -500, saldoPosteriorCents: null, seq: 1 },
      { id: 'c', dataOperacio: '2026-06-10', importCents: -200, saldoPosteriorCents: null, seq: 2 },
    ];
    const saldos = creaSaldoAcumulatPerMoviment(moviments);
    expect(saldos.get('a')).toBe(-1000);
    expect(saldos.get('b')).toBe(-1500);
    expect(saldos.get('c')).toBe(-1700);
  });

  it('is independent of input order, using dataOperacio + seq to sequence same-day movements', () => {
    const a = { id: 'a', dataOperacio: '2026-06-05', importCents: -100, saldoPosteriorCents: null, seq: 0 };
    const b = { id: 'b', dataOperacio: '2026-06-05', importCents: -200, saldoPosteriorCents: null, seq: 1 };
    const c = { id: 'c', dataOperacio: '2026-06-05', importCents: 50, saldoPosteriorCents: null, seq: 2 };

    expect(creaSaldoAcumulatPerMoviment([a, b, c])).toEqual(creaSaldoAcumulatPerMoviment([c, a, b]));
    const saldos = creaSaldoAcumulatPerMoviment([c, a, b]);
    expect(saldos.get('a')).toBe(-100);
    expect(saldos.get('b')).toBe(-300);
    expect(saldos.get('c')).toBe(-250);
  });

  it('a settlement contrapartida cancels exactly the settled amount, leaving only out-of-cycle charges as pending debt', () => {
    // Mirrors the real-world case where the settlement date (5th) doesn't
    // match the billing cutoff (26th of the previous month): charges dated
    // after the cutoff but before the settlement date (27-2) are NOT part of
    // this settlement's billed amount, yet they must still show up as
    // pending debt afterwards, not get silently cancelled out.
    const carrec20 = { id: 'c20', dataOperacio: '2026-06-20', importCents: -5000, saldoPosteriorCents: null, seq: 0 };
    const carrec26 = { id: 'c26', dataOperacio: '2026-06-26', importCents: -3000, saldoPosteriorCents: null, seq: 1 };
    const carrec27 = { id: 'c27', dataOperacio: '2026-06-27', importCents: -4000, saldoPosteriorCents: null, seq: 2 };
    const carrec02 = { id: 'c02', dataOperacio: '2026-07-02', importCents: -2000, saldoPosteriorCents: null, seq: 3 };
    // Billed amount only covers charges up to the 26th (5000+3000=8000).
    const contrapartida = { id: 'liq', dataOperacio: '2026-07-05', importCents: 8000, saldoPosteriorCents: null, seq: 4 };

    const saldos = creaSaldoAcumulatPerMoviment([carrec20, carrec26, carrec27, carrec02, contrapartida]);
    expect(saldos.get('liq')).toBe(-4000 + -2000); // -6000: exactly the still-unsettled 27th + 2nd charges.
  });
});
