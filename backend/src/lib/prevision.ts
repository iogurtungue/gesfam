import { afegeixDies, afegeixMesos, diesEntre, isoAvui } from './dates';
import type { PeriodicitatRecurrent } from '../db/types';

export interface RecurrentPerProjeccio {
  id: string;
  compteId: string;
  concepte: string;
  periodicitat: PeriodicitatRecurrent;
  importCents: number;
  dataPrevista: string;
  dataFi?: string;
  categoriaId?: string;
  esTransferenciaInterna?: boolean;
}

export interface MovimentPerConciliacio {
  compteId: string;
  dataOperacio: string;
  importCents: number;
}

export interface EsdevenimentPrevist {
  data: string;
  compteId: string;
  concepte: string;
  importCents: number;
  recurrentId: string;
  categoriaId?: string;
  esTransferenciaInterna?: boolean;
  /** L'ocurrència prevista a `dataPrevistaOriginal` ja havia passat (i encara no s'ha conciliat) quan es va calcular la previsió, així que es mostra desplaçada (`DIES_DESPLACAMENT_VENCUT`) en lloc de desaparèixer sense avís. Tant per a `unica` com per a l'ocurrència més recent d'un recurrent periòdic. */
  vençut?: boolean;
  /** Només quan `vençut`: la data de venciment original (abans de desplaçar-la), per mostrar-la a la UI. */
  dataPrevistaOriginal?: string;
}

export interface PuntSerieDiaria {
  data: string;
  saldoPerCompte: Record<string, number>;
  saldoTotal: number;
}

/** "Pocs dies" (especificacio.md 4.2, sub-fase 3.6): finestra al voltant de la data prevista dins la qual un moviment real ja importat es considera la liquidació d'aquell recurrent. */
const FINESTRA_CONCILIACIO_DIES = 3;
const TOLERANCIA_IMPORT_CONCILIACIO = 0.15;
/** Un compromís vençut (unica o l'ocurrència més recent d'un periòdic) i encara no conciliat es mostra desplaçat aquests dies respecte a avui (no exactament avui), perquè quedi clarament identificat com a pendent sense amuntegar-se tot a la data d'avui. */
const DIES_DESPLACAMENT_VENCUT = 10;
/** Un cop una ocurrència ja es considera vençuda, la finestra de conciliació estricta (±3 dies) deixa de ser realista: el pagament real pot arribar amb més retard. Es dona per resolta si hi ha un moviment real semblant en qualsevol data entre el venciment original i aquests dies després — sense límit, un import similar mesos després podria ser pura coincidència. */
const FINESTRA_RESOLUCIO_VENCUT_DIES = 30;

function esConciliat(compteId: string, data: string, importCents: number, moviments: MovimentPerConciliacio[]): boolean {
  const marge = Math.abs(importCents) * TOLERANCIA_IMPORT_CONCILIACIO;
  return moviments.some(
    (m) =>
      m.compteId === compteId &&
      Math.sign(m.importCents) === Math.sign(importCents) &&
      Math.abs(diesEntre(data, m.dataOperacio)) <= FINESTRA_CONCILIACIO_DIES &&
      Math.abs(Math.abs(m.importCents) - Math.abs(importCents)) <= marge,
  );
}

/** Com `esConciliat`, però per a una ocurrència ja vençuda: només compta un moviment real des de la data de venciment original endavant (mai abans, ja l'hauria detectat `esConciliat` quan encara no era vençuda), amb una finestra més àmplia (`FINESTRA_RESOLUCIO_VENCUT_DIES`) perquè un pagament amb més de 3 dies de retard es reconegui igualment. */
function esConciliatVencut(compteId: string, dataOcurrencia: string, importCents: number, moviments: MovimentPerConciliacio[]): boolean {
  const marge = Math.abs(importCents) * TOLERANCIA_IMPORT_CONCILIACIO;
  return moviments.some(
    (m) =>
      m.compteId === compteId &&
      Math.sign(m.importCents) === Math.sign(importCents) &&
      diesEntre(dataOcurrencia, m.dataOperacio) >= 0 &&
      diesEntre(dataOcurrencia, m.dataOperacio) <= FINESTRA_RESOLUCIO_VENCUT_DIES &&
      Math.abs(Math.abs(m.importCents) - Math.abs(importCents)) <= marge,
  );
}

/** Avança una data un període segons la periodicitat (mesos de calendari o dies). Exportada perquè `db/operations.ts` la reutilitzi en descartar una ocurrència prevista d'un recurrent periòdic (spec 4.3). */
export function avancaPeriodicitat(data: string, periodicitat: Exclude<PeriodicitatRecurrent, 'unica'>): string {
  switch (periodicitat) {
    case 'setmanal':
      return afegeixDies(data, 7);
    case 'mensual':
      return afegeixMesos(data, 1);
    case 'bimestral':
      return afegeixMesos(data, 2);
    case 'trimestral':
      return afegeixMesos(data, 3);
    case 'semestral':
      return afegeixMesos(data, 6);
    case 'anual':
      return afegeixMesos(data, 12);
  }
}

function esdevenimentVencut(r: RecurrentPerProjeccio, dataOriginal: string, avui: string): EsdevenimentPrevist {
  return {
    data: afegeixDies(avui, DIES_DESPLACAMENT_VENCUT),
    compteId: r.compteId,
    concepte: r.concepte,
    importCents: r.importCents,
    recurrentId: r.id,
    categoriaId: r.categoriaId,
    esTransferenciaInterna: r.esTransferenciaInterna,
    vençut: true,
    dataPrevistaOriginal: dataOriginal,
  };
}

/**
 * Motor de projecció (especificacio.md 4.3, sub-fase 4.1): calcula, per a cada
 * recurrent confirmat, quines ocurrències futures (avui inclòs) cauen dins
 * l'horitzó, aplicant la conciliació (3.6) — si ja hi ha un moviment real
 * semblant a prop de la data prevista, no es projecta.
 *
 * Un compromís puntual (`unica`) amb `dataPrevista` passada i encara no
 * conciliat no desapareix: es projecta desplaçat `DIES_DESPLACAMENT_VENCUT`
 * dies després d'avui, marcat `vençut: true` (amb `dataPrevistaOriginal` per
 * mostrar el venciment real).
 *
 * Un recurrent **periòdic** amb `dataPrevista` desfasada avança silenciosament
 * (sense comprovar conciliació) totes les ocurrències anteriors a l'última
 * abans d'avui — però aquesta última sí que es comprova: si tampoc s'ha
 * conciliat, es projecta igualment com a "vençuda" (mateix tractament que un
 * `unica`), sense interrompre la projecció normal de les properes ocurrències
 * futures. Només es vigila l'ocurrència més recent (mai totes les passades),
 * perquè un recurrent abandonat fa mesos no ompli la previsió d'avisos.
 *
 * Un cop una ocurrència és vençuda, la conciliació que la pot resoldre fa
 * servir una finestra més àmplia (`esConciliatVencut`, `FINESTRA_RESOLUCIO_VENCUT_DIES`
 * dies des del venciment original) en lloc de la finestra estricta (±3 dies)
 * — un pagament vençut pot arribar amb més retard del que es considera normal
 * per a un pagament puntual.
 *
 * Pura funció — no llegeix ni escriu la base de dades.
 */
export function projectaEsdeveniments(
  recurrents: RecurrentPerProjeccio[],
  movimentsPerConciliacio: MovimentPerConciliacio[],
  horitzoDies: number,
  avui: string = isoAvui(),
): EsdevenimentPrevist[] {
  const dataLimit = afegeixDies(avui, horitzoDies);
  const esdeveniments: EsdevenimentPrevist[] = [];

  for (const r of recurrents) {
    if (r.periodicitat === 'unica') {
      if (r.dataPrevista > dataLimit) continue;
      const vençut = r.dataPrevista < avui;
      if (vençut) {
        if (esConciliatVencut(r.compteId, r.dataPrevista, r.importCents, movimentsPerConciliacio)) continue;
        const esdeveniment = esdevenimentVencut(r, r.dataPrevista, avui);
        if (r.dataFi && esdeveniment.data > r.dataFi) continue;
        esdeveniments.push(esdeveniment);
        continue;
      }
      if (r.dataFi && r.dataPrevista > r.dataFi) continue;
      if (esConciliat(r.compteId, r.dataPrevista, r.importCents, movimentsPerConciliacio)) continue;
      esdeveniments.push({
        data: r.dataPrevista,
        compteId: r.compteId,
        concepte: r.concepte,
        importCents: r.importCents,
        recurrentId: r.id,
        categoriaId: r.categoriaId,
        esTransferenciaInterna: r.esTransferenciaInterna,
      });
      continue;
    }

    let data = r.dataPrevista;
    let ultimaOcurrenciaPassada: string | undefined;
    let finalitzat = false;

    while (data < avui) {
      if (r.dataFi && data > r.dataFi) {
        finalitzat = true;
        break;
      }
      ultimaOcurrenciaPassada = data;
      data = avancaPeriodicitat(data, r.periodicitat);
    }

    if (!finalitzat && ultimaOcurrenciaPassada && !esConciliatVencut(r.compteId, ultimaOcurrenciaPassada, r.importCents, movimentsPerConciliacio)) {
      const esdeveniment = esdevenimentVencut(r, ultimaOcurrenciaPassada, avui);
      if (!(r.dataFi && esdeveniment.data > r.dataFi)) {
        esdeveniments.push(esdeveniment);
      }
    }

    if (finalitzat) continue;

    while (data <= dataLimit) {
      if (r.dataFi && data > r.dataFi) break;

      if (!esConciliat(r.compteId, data, r.importCents, movimentsPerConciliacio)) {
        esdeveniments.push({
          data,
          compteId: r.compteId,
          concepte: r.concepte,
          importCents: r.importCents,
          recurrentId: r.id,
          categoriaId: r.categoriaId,
          esTransferenciaInterna: r.esTransferenciaInterna,
        });
      }

      data = avancaPeriodicitat(data, r.periodicitat);
    }
  }

  return esdeveniments.sort((a, b) => a.data.localeCompare(b.data) || a.compteId.localeCompare(b.compteId));
}

/** Sèrie diària de saldo (un punt per dia, d'avui a avui+horitzó), acumulant els esdeveniments previstos sobre els saldos inicials per compte. */
export function construeixSerieDiaria(
  saldosInicialsPerCompte: Record<string, number>,
  esdeveniments: EsdevenimentPrevist[],
  horitzoDies: number,
  avui: string = isoAvui(),
): PuntSerieDiaria[] {
  const esdevenimentsPerData = new Map<string, EsdevenimentPrevist[]>();
  for (const e of esdeveniments) {
    const llista = esdevenimentsPerData.get(e.data);
    if (llista) {
      llista.push(e);
    } else {
      esdevenimentsPerData.set(e.data, [e]);
    }
  }

  const saldos = { ...saldosInicialsPerCompte };
  const serie: PuntSerieDiaria[] = [];
  for (let dia = 0; dia <= horitzoDies; dia++) {
    const data = afegeixDies(avui, dia);
    for (const e of esdevenimentsPerData.get(data) ?? []) {
      saldos[e.compteId] = (saldos[e.compteId] ?? 0) + e.importCents;
    }
    const saldoTotal = Object.values(saldos).reduce((suma, s) => suma + s, 0);
    serie.push({ data, saldoPerCompte: { ...saldos }, saldoTotal });
  }
  return serie;
}
