import type { AccountType } from '../api/types';

export interface MovimentPerSaldo {
  dataOperacio: string;
  importCents: number;
  saldoPosteriorCents: number | null;
  /** Insertion order tiebreak for same-day movements — see Moviment.seq. */
  seq: number;
}

/**
 * Reconstructs the true chronological order of a single account's movements
 * using each movement's own recorded balance, not `seq` — `seq` is reliable
 * for anything imported after it was introduced, but movements imported
 * before that only got a *best-effort* backfilled value (see schema.ts's v3
 * migration), which falls back to arbitrary order for same-day movements
 * from the same import batch. That's unrecoverable from `seq` alone, but not
 * from the data itself: for movement M, `saldoPosteriorCents - importCents`
 * is the balance immediately *before* M was applied, which must equal the
 * immediately-preceding movement's `saldoPosteriorCents`. Chaining that
 * match reconstructs the real order independent of import history.
 *
 * Grouping by date first (dates are always reliable, unlike intra-day order)
 * keeps this cheap and keeps the chain anchored even where it can't be
 * fully resolved (a gap, or the very first movement ever, which has no
 * predecessor to match against) — those cases fall back to `seq`, but only
 * for the unresolvable subset, not the whole history.
 */
function ordenaCronologicament(moviments: MovimentPerSaldo[]): MovimentPerSaldo[] {
  const perData = new Map<string, MovimentPerSaldo[]>();
  for (const m of moviments) {
    const grup = perData.get(m.dataOperacio);
    if (grup) grup.push(m);
    else perData.set(m.dataOperacio, [m]);
  }

  const resultat: MovimentPerSaldo[] = [];
  let saldoConegut: number | null = null;

  for (const data of [...perData.keys()].sort()) {
    const pool = [...perData.get(data)!];
    while (pool.length > 0) {
      let index: number = saldoConegut === null ? -1 : pool.findIndex((m) => m.saldoPosteriorCents !== null && m.saldoPosteriorCents - m.importCents === saldoConegut);
      if (index === -1) {
        // No chain match: gap, ambiguous duplicate, or the very first
        // movement. Best-effort fallback — pick the lowest `seq` available.
        pool.sort((a, b) => a.seq - b.seq);
        index = 0;
      }
      const [seguent] = pool.splice(index, 1);
      resultat.push(seguent);
      if (seguent.saldoPosteriorCents !== null) saldoConegut = seguent.saldoPosteriorCents;
    }
  }

  return resultat;
}

/**
 * Reconstructs an account's balance as of a given date (spec 3.5: "vista de
 * saldos a una data"). For compte corrent, uses the most recent known
 * running balance on or before that date (Norma 43 and most table exports
 * carry saldoPosteriorCents on every movement), found via true chronological
 * order (see ordenaCronologicament). For targeta accounts there is no
 * running balance in the source data — only individual charges — so the
 * "saldo" is the accumulated debt from the imported movements themselves
 * (spec 3.2.1: a card's balance is outstanding debt, not available funds);
 * that sum is order-independent, so it doesn't need reordering.
 *
 * `moviments` should already be filtered to a single account; order doesn't
 * matter, this reorders internally.
 */
export function saldoEnData(moviments: MovimentPerSaldo[], tipus: AccountType, dataISO: string): number | null {
  const rellevants = moviments.filter((m) => m.dataOperacio <= dataISO);
  if (rellevants.length === 0) return null;

  if (tipus === 'targeta') {
    return rellevants.reduce((sum, m) => sum + m.importCents, 0);
  }

  const ordenats = ordenaCronologicament(rellevants);
  for (let i = ordenats.length - 1; i >= 0; i--) {
    if (ordenats[i].saldoPosteriorCents !== null) {
      return ordenats[i].saldoPosteriorCents;
    }
  }
  return null;
}
