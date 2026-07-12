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
  /** Només per a `unica`: la `dataPrevista` original ja havia passat (i encara no s'ha conciliat) quan es va calcular la previsió, així que es mostra desplaçat (`DIES_DESPLACAMENT_VENCUT`) en lloc de desaparèixer sense avís. */
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
/** Un compromís puntual (`unica`) vençut i encara no conciliat es mostra desplaçat aquests dies respecte a avui (no exactament avui), perquè quedi clarament identificat com a pendent sense amuntegar-se tot a la data d'avui. */
const DIES_DESPLACAMENT_VENCUT = 10;

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

/**
 * Motor de projecció (especificacio.md 4.3, sub-fase 4.1): calcula, per a cada
 * recurrent confirmat, quines ocurrències futures (avui inclòs) cauen dins
 * l'horitzó, aplicant la conciliació (3.6) — si ja hi ha un moviment real
 * semblant a prop de la data prevista, no es projecta. Per a un recurrent
 * periòdic amb `dataPrevista` desfasada, s'avança silenciosament (sense
 * comprovar conciliació de les ocurrències saltades) fins a la primera
 * ocurrència que ja no sigui anterior a avui. Un compromís puntual (`unica`)
 * amb `dataPrevista` passada i encara no conciliat, en canvi, no desapareix:
 * es projecta desplaçat `DIES_DESPLACAMENT_VENCUT` dies després d'avui,
 * marcat `vençut: true` (amb `dataPrevistaOriginal` per mostrar el venciment
 * real) perquè es pugui distingir a la UI d'un venciment que realment cau
 * en aquella data. Pura funció — no llegeix ni escriu la base de dades.
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
      const data = vençut ? afegeixDies(avui, DIES_DESPLACAMENT_VENCUT) : r.dataPrevista;
      if (r.dataFi && data > r.dataFi) continue;
      if (esConciliat(r.compteId, r.dataPrevista, r.importCents, movimentsPerConciliacio)) continue;
      esdeveniments.push({
        data,
        compteId: r.compteId,
        concepte: r.concepte,
        importCents: r.importCents,
        recurrentId: r.id,
        categoriaId: r.categoriaId,
        esTransferenciaInterna: r.esTransferenciaInterna,
        ...(vençut && { vençut: true, dataPrevistaOriginal: r.dataPrevista }),
      });
      continue;
    }

    let data = r.dataPrevista;
    while (data <= dataLimit) {
      if (r.dataFi && data > r.dataFi) break;

      if (data >= avui && !esConciliat(r.compteId, data, r.importCents, movimentsPerConciliacio)) {
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
