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
function ordenaCronologicament<T extends MovimentPerSaldo>(moviments: T[]): T[] {
  const perData = new Map<string, T[]>();
  for (const m of moviments) {
    const grup = perData.get(m.dataOperacio);
    if (grup) grup.push(m);
    else perData.set(m.dataOperacio, [m]);
  }

  const resultat: T[] = [];
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

/**
 * Same result as calling saldoEnData() repeatedly for many different dates
 * of the same account, but computed once instead of re-filtering/reordering
 * the whole history on every call — used by the Moviments table to fill in
 * an account's running balance on rows where it had no movement that day
 * (spec: totes les columnes de saldo s'omplen a cada fila, amb independència
 * de si hi ha import per aquell compte).
 */
export function creaConsultaSaldo(moviments: MovimentPerSaldo[], tipus: AccountType): (dataISO: string) => number | null {
  const punts: { dataOperacio: string; saldoCents: number }[] = [];

  if (tipus === 'targeta') {
    const perData = new Map<string, number>();
    for (const m of moviments) {
      perData.set(m.dataOperacio, (perData.get(m.dataOperacio) ?? 0) + m.importCents);
    }
    let acumulat = 0;
    for (const data of [...perData.keys()].sort()) {
      acumulat += perData.get(data)!;
      punts.push({ dataOperacio: data, saldoCents: acumulat });
    }
  } else {
    const perData = new Map<string, number>();
    let saldoConegut: number | null = null;
    for (const m of ordenaCronologicament(moviments)) {
      if (m.saldoPosteriorCents !== null) saldoConegut = m.saldoPosteriorCents;
      if (saldoConegut !== null) perData.set(m.dataOperacio, saldoConegut);
    }
    for (const data of [...perData.keys()].sort()) {
      punts.push({ dataOperacio: data, saldoCents: perData.get(data)! });
    }
  }

  return (dataISO: string) => {
    let baix = 0;
    let alt = punts.length - 1;
    let resultat: number | null = null;
    while (baix <= alt) {
      const mig = (baix + alt) >> 1;
      if (punts[mig].dataOperacio <= dataISO) {
        resultat = punts[mig].saldoCents;
        baix = mig + 1;
      } else {
        alt = mig - 1;
      }
    }
    return resultat;
  };
}

export interface MovimentAcumulat extends MovimentPerSaldo {
  id: string;
  lotImportacioId: string;
}

/**
 * Els fitxers de targeta no porten ni saldo ni hora, només data, així que
 * `seq` (ordre d'inserció durant la importació) és l'únic senyal disponible
 * per desempatar moviments del mateix dia -- però `seq` només reflecteix
 * l'ordre de les files al fitxer d'origen, i aquest ordre no és consistent:
 * alguns extractes llisten de més recent a més antic, d'altres a l'inrevés,
 * i el conveni pot variar fins i tot entre dos lots del mateix compte (
 * comprovat amb dades reals). Per això la direcció es dedueix per lot,
 * comparant el seq dels moviments de la data més antiga d'aquell lot contra
 * els de la data més recent: si el seq puja amb la data, el lot és
 * ascendent; si baixa, és descendent.
 *
 * Retorna 0 (sense senyal) quan el lot només té una data -- típicament un
 * lot curt on la deduplicació ha descartat totes les files excepte les d'un
 * sol dia (bug real detectat: un lot de 4 moviments, tots del mateix dia,
 * queia sempre al "per defecte ascendent" encara que el conveni real del
 * fitxer -- i de la resta de lots del mateix compte -- fos descendent). El
 * cridant ha de resoldre aquest cas amb algun altre senyal (veure
 * creaSaldoAcumulatPerMoviment).
 */
function inferDireccio(moviments: { dataOperacio: string; seq: number }[]): 1 | -1 | 0 {
  let dataMin = moviments[0].dataOperacio;
  let dataMax = moviments[0].dataOperacio;
  for (const m of moviments) {
    if (m.dataOperacio < dataMin) dataMin = m.dataOperacio;
    if (m.dataOperacio > dataMax) dataMax = m.dataOperacio;
  }
  if (dataMin === dataMax) return 0;

  const mitjana = (data: string) => {
    const seqs = moviments.filter((m) => m.dataOperacio === data).map((m) => m.seq);
    return seqs.reduce((a, b) => a + b, 0) / seqs.length;
  };
  return mitjana(dataMax) >= mitjana(dataMin) ? 1 : -1;
}

/**
 * Reconstrueix l'ordre cronològic real dels moviments d'un compte targeta
 * (veure inferDireccio per què cal fer-ho lot a lot en lloc de confiar en
 * `seq` directament). Únic punt on es decideix aquest ordre: tant
 * creaSaldoAcumulatPerMoviment (el valor de saldo) com la taula de
 * Moviments (l'ordre visual de les files) l'han d'utilitzar, o els dos
 * deixen de coincidir i els saldos tornen a semblar desordenats encara que
 * cadascun, per separat, sigui "correcte".
 */
function ordenaMovimentsTargeta(moviments: MovimentAcumulat[]): MovimentAcumulat[] {
  const perLot = new Map<string, MovimentAcumulat[]>();
  for (const m of moviments) {
    const grup = perLot.get(m.lotImportacioId);
    if (grup) grup.push(m);
    else perLot.set(m.lotImportacioId, [m]);
  }

  // Cada lot amb senyal propi (més d'una data) vota per la seva direcció;
  // un lot sense senyal (una sola data) es resol després amb el vot
  // majoritari de la resta de lots del mateix compte -- el conveni d'un
  // fitxer és una propietat del banc/compte, no d'un lot concret, així que
  // "manlleva-la de la resta de la teva pròpia història" és més fiable que
  // triar sempre ascendent a cegues.
  const direccioPerLot = new Map<string, 1 | -1>();
  let vots = 0;
  for (const [lotId, grup] of perLot) {
    const direccio = inferDireccio(grup);
    if (direccio !== 0) {
      direccioPerLot.set(lotId, direccio);
      vots += direccio;
    }
  }
  const direccioPerDefecte: 1 | -1 = vots < 0 ? -1 : 1;
  for (const lotId of perLot.keys()) {
    if (!direccioPerLot.has(lotId)) direccioPerLot.set(lotId, direccioPerDefecte);
  }

  return [...moviments].sort((a, b) => {
    if (a.dataOperacio !== b.dataOperacio) return a.dataOperacio.localeCompare(b.dataOperacio);
    if (a.lotImportacioId !== b.lotImportacioId) return a.seq - b.seq;
    return (direccioPerLot.get(a.lotImportacioId) ?? 1) * (a.seq - b.seq);
  });
}

/**
 * Deute acumulat d'un compte targeta immediatament després de cada moviment
 * concret (a diferència de creaConsultaSaldo, que només resol "saldo vigent
 * en una data" i per tant no distingeix entre diversos moviments del mateix
 * dia). Com que la suma és order-independent (veure saldoEnData), l'ordre
 * cronològic exacte dins del mateix dia només importa per decidir quin
 * valor mostrar a cada fila, no pel resultat final acumulat -- però cal
 * encertar-lo igualment perquè els valors intermedis no semblin desordenats.
 */
export function creaSaldoAcumulatPerMoviment(moviments: MovimentAcumulat[]): Map<string, number> {
  const resultat = new Map<string, number>();
  let acumulat = 0;
  for (const m of ordenaMovimentsTargeta(moviments)) {
    acumulat += m.importCents;
    resultat.set(m.id, acumulat);
  }
  return resultat;
}

/**
 * Posició de cada moviment en l'ordre cronològic real reconstruït (0 = el
 * més antic). Perquè la taula de Moviments pugui ordenar visualment les
 * files d'un mateix dia igual que creaSaldoAcumulatPerMoviment les ha
 * comptat -- altrament l'ordre de pantalla i el valor de saldo es calculen
 * de manera independent i poden discrepar (els saldos tornen a semblar
 * desordenats encara que el número de cada fila sigui correcte).
 */
export function creaRangCronologicPerMoviment(moviments: MovimentAcumulat[]): Map<string, number> {
  const resultat = new Map<string, number>();
  ordenaMovimentsTargeta(moviments).forEach((m, index) => resultat.set(m.id, index));
  return resultat;
}

/**
 * Equivalent de creaRangCronologicPerMoviment per a comptes corrent: la taula
 * de Moviments ha d'ordenar visualment les files d'un mateix dia igual que
 * ordenaCronologicament (la reconstrucció per cadena de saldo que ja fa
 * servir saldoEnData/creaConsultaSaldo), no per `seq` cru -- alguns extractes
 * (comprovat amb dades reals d'ING) llisten les files del més recent al més
 * antic, així que `seq` ascendent és sovint l'ordre cronològic invers dins
 * d'un mateix dia (bug real: els dos moviments del 23/07 apareixien en
 * l'ordre contrari al que reflectia el seu propi saldo).
 */
export function creaRangCronologicCorrentPerMoviment(moviments: MovimentAcumulat[]): Map<string, number> {
  const resultat = new Map<string, number>();
  ordenaCronologicament(moviments).forEach((m, index) => resultat.set(m.id, index));
  return resultat;
}
