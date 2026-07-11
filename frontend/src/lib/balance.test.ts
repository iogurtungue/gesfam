import { describe, expect, it } from 'vitest';
import { creaConsultaSaldo, creaRangCronologicPerMoviment, creaSaldoAcumulatPerMoviment, saldoEnData } from './balance';

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
      { id: 'a', dataOperacio: '2026-06-01', importCents: -1000, saldoPosteriorCents: null, seq: 0, lotImportacioId: 'L1' },
      { id: 'b', dataOperacio: '2026-06-05', importCents: -500, saldoPosteriorCents: null, seq: 1, lotImportacioId: 'L1' },
      { id: 'c', dataOperacio: '2026-06-10', importCents: -200, saldoPosteriorCents: null, seq: 2, lotImportacioId: 'L1' },
    ];
    const saldos = creaSaldoAcumulatPerMoviment(moviments);
    expect(saldos.get('a')).toBe(-1000);
    expect(saldos.get('b')).toBe(-1500);
    expect(saldos.get('c')).toBe(-1700);
  });

  it('is independent of input order for an ascending lot (single-day lot defaults to ascending seq)', () => {
    const a = { id: 'a', dataOperacio: '2026-06-05', importCents: -100, saldoPosteriorCents: null, seq: 0, lotImportacioId: 'L1' };
    const b = { id: 'b', dataOperacio: '2026-06-05', importCents: -200, saldoPosteriorCents: null, seq: 1, lotImportacioId: 'L1' };
    const c = { id: 'c', dataOperacio: '2026-06-05', importCents: 50, saldoPosteriorCents: null, seq: 2, lotImportacioId: 'L1' };

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
    const carrec20 = { id: 'c20', dataOperacio: '2026-06-20', importCents: -5000, saldoPosteriorCents: null, seq: 0, lotImportacioId: 'L1' };
    const carrec26 = { id: 'c26', dataOperacio: '2026-06-26', importCents: -3000, saldoPosteriorCents: null, seq: 1, lotImportacioId: 'L1' };
    const carrec27 = { id: 'c27', dataOperacio: '2026-06-27', importCents: -4000, saldoPosteriorCents: null, seq: 2, lotImportacioId: 'L1' };
    const carrec02 = { id: 'c02', dataOperacio: '2026-07-02', importCents: -2000, saldoPosteriorCents: null, seq: 3, lotImportacioId: 'L1' };
    // Billed amount only covers charges up to the 26th (5000+3000=8000).
    const contrapartida = { id: 'liq', dataOperacio: '2026-07-05', importCents: 8000, saldoPosteriorCents: null, seq: 4, lotImportacioId: 'L1' };

    const saldos = creaSaldoAcumulatPerMoviment([carrec20, carrec26, carrec27, carrec02, contrapartida]);
    expect(saldos.get('liq')).toBe(-4000 + -2000); // -6000: exactly the still-unsettled 27th + 2nd charges.
  });

  it('reconstructs same-day order for a descending lot (the actual reported bug: ING-TG-JN, 27-30/11/2025)', () => {
    // Real data: this lot lists movements from most recent date to oldest
    // (seq goes 1110 on 27/11 down to 1106-1108 on 30/11), so ascending seq
    // is the WRONG tie-break direction within the 30/11 group -- the file's
    // last-listed row of that day (lowest seq) is chronologically its most
    // recent charge, not its first.
    const d27 = { id: '27', dataOperacio: '2025-11-27', importCents: -625, saldoPosteriorCents: null, seq: 1110, lotImportacioId: 'ing1' };
    const d28 = { id: '28', dataOperacio: '2025-11-28', importCents: -414, saldoPosteriorCents: null, seq: 1109, lotImportacioId: 'ing1' };
    // Within the file, 30a comes first (highest seq of the group is listed first for a descending lot... here seq 1108 is listed first, 1106 last).
    const d30a = { id: '30a', dataOperacio: '2025-11-30', importCents: -5000, saldoPosteriorCents: null, seq: 1108, lotImportacioId: 'ing1' };
    const d30b = { id: '30b', dataOperacio: '2025-11-30', importCents: -3000, saldoPosteriorCents: null, seq: 1107, lotImportacioId: 'ing1' };
    const d30c = { id: '30c', dataOperacio: '2025-11-30', importCents: -2109, saldoPosteriorCents: null, seq: 1106, lotImportacioId: 'ing1' };

    const saldos = creaSaldoAcumulatPerMoviment([d30c, d30b, d30a, d28, d27]);
    expect(saldos.get('27')).toBe(-625);
    expect(saldos.get('28')).toBe(-1039); // matches the -10,39 € the user confirmed as correct.
    // Descending lot: within 30/11, higher seq (1108) is chronologically first.
    expect(saldos.get('30a')).toBe(-1039 - 5000); // -6039
    expect(saldos.get('30b')).toBe(-6039 - 3000); // -9039
    expect(saldos.get('30c')).toBe(-9039 - 2109); // -11148
  });

  it('infers direction independently per lot (confirmed with real data: two lots of the same account, one ascending, one descending)', () => {
    const ascA = { id: 'ascA', dataOperacio: '2026-01-01', importCents: -100, saldoPosteriorCents: null, seq: 0, lotImportacioId: 'ascendent' };
    const ascB1 = { id: 'ascB1', dataOperacio: '2026-01-05', importCents: -10, saldoPosteriorCents: null, seq: 1, lotImportacioId: 'ascendent' };
    const ascB2 = { id: 'ascB2', dataOperacio: '2026-01-05', importCents: -20, saldoPosteriorCents: null, seq: 2, lotImportacioId: 'ascendent' };

    const descA = { id: 'descA', dataOperacio: '2026-02-05', importCents: -30, saldoPosteriorCents: null, seq: 10, lotImportacioId: 'descendent' };
    const descB1 = { id: 'descB1', dataOperacio: '2026-02-01', importCents: -1, saldoPosteriorCents: null, seq: 11, lotImportacioId: 'descendent' };
    const descB2 = { id: 'descB2', dataOperacio: '2026-02-01', importCents: -2, saldoPosteriorCents: null, seq: 12, lotImportacioId: 'descendent' };

    const saldos = creaSaldoAcumulatPerMoviment([ascA, ascB1, ascB2, descA, descB1, descB2]);
    // Ascending lot: within 01/05, seq 1 (ascB1) comes before seq 2 (ascB2).
    expect(saldos.get('ascB1')).toBe(-100 - 10);
    expect(saldos.get('ascB2')).toBe(-100 - 10 - 20);
    // Descending lot: within 02/01, higher seq (descB2=12) comes before lower seq (descB1=11).
    const acumulatFinsAscendent = -100 - 10 - 20;
    expect(saldos.get('descB2')).toBe(acumulatFinsAscendent - 2);
    expect(saldos.get('descB1')).toBe(acumulatFinsAscendent - 2 - 1);
  });

  it('a single-date lot (no internal signal) borrows the majority direction of the rest of the account (the actual reported bug: ING-TG-JA, 27/11/2025)', () => {
    // Real data: a short lot ended up containing only one calendar date
    // (27/11) after deduplication -- with a single date there's no cross-date
    // seq/data correlation to infer a direction from, so it used to fall back
    // to a hardcoded "ascending" default regardless of the account's real
    // convention. This account's other (multi-date) lot is clearly
    // descending, so the single-date lot should borrow that instead of
    // guessing ascending blindly.
    const d27a = { id: '27a', dataOperacio: '2025-11-27', importCents: -10402, saldoPosteriorCents: null, seq: 1147, lotImportacioId: 'lot-un-sol-dia' };
    const d27b = { id: '27b', dataOperacio: '2025-11-27', importCents: -1375, saldoPosteriorCents: null, seq: 1148, lotImportacioId: 'lot-un-sol-dia' };
    const d27c = { id: '27c', dataOperacio: '2025-11-27', importCents: -1400, saldoPosteriorCents: null, seq: 1149, lotImportacioId: 'lot-un-sol-dia' };
    const d27d = { id: '27d', dataOperacio: '2025-11-27', importCents: -6315, saldoPosteriorCents: null, seq: 1150, lotImportacioId: 'lot-un-sol-dia' };
    // Decisively descending multi-date lot from the rest of the account's history.
    const d28 = { id: '28', dataOperacio: '2025-11-28', importCents: -2300, saldoPosteriorCents: null, seq: 1146, lotImportacioId: 'lot-multi-dia' };
    const d12_01 = { id: '12-01', dataOperacio: '2025-12-01', importCents: -69, saldoPosteriorCents: null, seq: 1145, lotImportacioId: 'lot-multi-dia' };

    const saldos = creaSaldoAcumulatPerMoviment([d27a, d27b, d27c, d27d, d28, d12_01]);
    // Borrowed descending direction: within 27/11, higher seq (1150, the
    // -63.15 movement) comes first, not last.
    expect(saldos.get('27d')).toBe(-6315); // -63.15, not the almost-whole-day -194.92 the user actually saw.
    expect(saldos.get('27c')).toBe(-6315 - 1400);
    expect(saldos.get('27b')).toBe(-6315 - 1400 - 1375);
    expect(saldos.get('27a')).toBe(-6315 - 1400 - 1375 - 10402);
  });

  it('defaults to ascending when no lot in the account has any signal at all (every lot is single-date)', () => {
    const a = { id: 'a', dataOperacio: '2026-01-01', importCents: -100, saldoPosteriorCents: null, seq: 0, lotImportacioId: 'lot1' };
    const b = { id: 'b', dataOperacio: '2026-01-01', importCents: -200, saldoPosteriorCents: null, seq: 1, lotImportacioId: 'lot1' };
    const saldos = creaSaldoAcumulatPerMoviment([a, b]);
    expect(saldos.get('a')).toBe(-100);
    expect(saldos.get('b')).toBe(-300);
  });
});

describe('creaRangCronologicPerMoviment', () => {
  it('matches the order used by creaSaldoAcumulatPerMoviment, so the table can sort rows consistently with the saldo it shows', () => {
    const d27a = { id: '27a', dataOperacio: '2025-11-27', importCents: -10402, saldoPosteriorCents: null, seq: 1147, lotImportacioId: 'lot-un-sol-dia' };
    const d27b = { id: '27b', dataOperacio: '2025-11-27', importCents: -1375, saldoPosteriorCents: null, seq: 1148, lotImportacioId: 'lot-un-sol-dia' };
    const d28 = { id: '28', dataOperacio: '2025-11-28', importCents: -2300, saldoPosteriorCents: null, seq: 1146, lotImportacioId: 'lot-multi-dia' };
    const d12_01 = { id: '12-01', dataOperacio: '2025-12-01', importCents: -69, saldoPosteriorCents: null, seq: 1145, lotImportacioId: 'lot-multi-dia' };

    const moviments = [d27a, d27b, d28, d12_01];
    const rangs = creaRangCronologicPerMoviment(moviments);
    const saldos = creaSaldoAcumulatPerMoviment(moviments);

    const perRang = [...moviments].sort((x, y) => rangs.get(x.id)! - rangs.get(y.id)!);
    let acumulat = 0;
    for (const m of perRang) {
      acumulat += m.importCents;
      expect(saldos.get(m.id)).toBe(acumulat);
    }
  });
});
