import { afegeixDies, afegeixMesos, diesEntre, isoAvui } from './dates';
import type { PeriodicitatRecurrent } from '../db/types';

export interface RecurrentPerProjeccio {
  id: string;
  compteId: string;
  concepte: string;
  periodicitat: PeriodicitatRecurrent;
  importCents: number;
  /** Si `false`, la conciliació (`esConciliat`/`esConciliatVencut`) exigeix un import EXACTAMENT igual, no dins d'un marge de tolerància. */
  importAproximat: boolean;
  dataPrevista: string;
  dataFi?: string;
  categoriaId?: string;
  esTransferenciaInterna?: boolean;
}

export interface MovimentPerConciliacio {
  compteId: string;
  dataOperacio: string;
  importCents: number;
  categoriaId?: string;
}

export interface EsdevenimentPrevist {
  data: string;
  compteId: string;
  concepte: string;
  importCents: number;
  /** Propagat del recurrent d'origen (`RecurrentPerProjeccio.importAproximat`), per distingir-ho a la UI (com a Recurrents). */
  importAproximat: boolean;
  recurrentId: string;
  categoriaId?: string;
  esTransferenciaInterna?: boolean;
  /** L'ocurrència prevista a `dataPrevistaOriginal` ja havia passat (i encara no s'ha conciliat) quan es va calcular la previsió, així que es mostra desplaçada (`ConfiguracioConciliacio.diesDesplacamentVencut`) en lloc de desaparèixer sense avís. Tant per a `unica` com per a l'ocurrència més recent d'un recurrent periòdic. */
  vençut?: boolean;
  /** Només quan `vençut`: la data de venciment original (abans de desplaçar-la), per mostrar-la a la UI. */
  dataPrevistaOriginal?: string;
}

export interface PuntSerieDiaria {
  data: string;
  saldoPerCompte: Record<string, number>;
  saldoTotal: number;
}

/** Paràmetres de conciliació ajustables des de la pestanya "Configuració" (especificacio.md 4.4); persistits a `configuracio` i llegits per `db/operations.ts`, mai per aquest mòdul (que es manté pur). */
export interface ConfiguracioConciliacio {
  /** "Pocs dies" (especificacio.md 4.2, sub-fase 3.6): finestra al voltant de la data prevista dins la qual un moviment real ja importat es considera la liquidació d'un recurrent encara no vençut. */
  finestraConciliacioDies: number;
  /** Marge d'import (fracció, p. ex. 0.15 = 15%) només aplicable a un recurrent marcat `importAproximat`; un import real exigeix coincidència exacta (`importCoincideix`). */
  toleranciaImportConciliacio: number;
  /** Un compromís vençut (unica o l'ocurrència més recent d'un periòdic) i encara no conciliat es mostra desplaçat aquests dies respecte a avui (no exactament avui), perquè quedi clarament identificat com a pendent sense amuntegar-se tot a la data d'avui. */
  diesDesplacamentVencut: number;
  /** Un cop una ocurrència ja es considera vençuda, la finestra de conciliació estricta deixa de ser realista: el pagament real pot arribar amb més retard. Es dona per resolta si hi ha un moviment real semblant en qualsevol data entre el venciment original i aquests dies després — sense límit, un import similar mesos després podria ser pura coincidència. */
  finestraResolucioVencutDies: number;
}

/** Valors per defecte (els que eren constants fixes abans de la pestanya "Configuració"), usats quan `db/operations.ts` no en passa cap explícitament (p. ex. als tests d'aquest mòdul). */
export const CONFIGURACIO_CONCILIACIO_DEFECTE: ConfiguracioConciliacio = {
  finestraConciliacioDies: 3,
  toleranciaImportConciliacio: 0.15,
  diesDesplacamentVencut: 10,
  finestraResolucioVencutDies: 30,
};

/** Un recurrent amb import real (`importAproximat === false`) només conciliat per un import EXACTAMENT igual; un amb import aproximat manté el marge de tolerància. Sense aquesta distinció, un compte amb molts moviments d'import similar (p.ex. pagaments de diversos clients) conciliava falsament un compromís vençut amb un moviment real no relacionat, purament per coincidència d'import i data. */
function importCoincideix(r: RecurrentPerProjeccio, m: MovimentPerConciliacio, config: ConfiguracioConciliacio): boolean {
  if (!r.importAproximat) return m.importCents === r.importCents;
  const marge = Math.abs(r.importCents) * config.toleranciaImportConciliacio;
  return Math.abs(Math.abs(m.importCents) - Math.abs(r.importCents)) <= marge;
}

function esConciliat(r: RecurrentPerProjeccio, data: string, moviments: MovimentPerConciliacio[], config: ConfiguracioConciliacio): boolean {
  return moviments.some(
    (m) =>
      m.compteId === r.compteId &&
      m.categoriaId === r.categoriaId &&
      Math.sign(m.importCents) === Math.sign(r.importCents) &&
      Math.abs(diesEntre(data, m.dataOperacio)) <= config.finestraConciliacioDies &&
      importCoincideix(r, m, config),
  );
}

/** Com `esConciliat`, però per a una ocurrència ja vençuda: només compta un moviment real des de la data de venciment original endavant (mai abans, ja l'hauria detectat `esConciliat` quan encara no era vençuda), amb una finestra més àmplia (`finestraResolucioVencutDies`) perquè un pagament amb més retard es reconegui igualment. */
function esConciliatVencut(
  r: RecurrentPerProjeccio,
  dataOcurrencia: string,
  moviments: MovimentPerConciliacio[],
  config: ConfiguracioConciliacio,
): boolean {
  return moviments.some(
    (m) =>
      m.compteId === r.compteId &&
      m.categoriaId === r.categoriaId &&
      Math.sign(m.importCents) === Math.sign(r.importCents) &&
      diesEntre(dataOcurrencia, m.dataOperacio) >= 0 &&
      diesEntre(dataOcurrencia, m.dataOperacio) <= config.finestraResolucioVencutDies &&
      importCoincideix(r, m, config),
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

function esdevenimentVencut(r: RecurrentPerProjeccio, dataOriginal: string, avui: string, config: ConfiguracioConciliacio): EsdevenimentPrevist {
  return {
    data: afegeixDies(avui, config.diesDesplacamentVencut),
    compteId: r.compteId,
    concepte: r.concepte,
    importCents: r.importCents,
    importAproximat: r.importAproximat,
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
 * conciliat no desapareix: es projecta desplaçat `config.diesDesplacamentVencut`
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
 * servir una finestra més àmplia (`esConciliatVencut`, `config.finestraResolucioVencutDies`
 * dies des del venciment original) en lloc de la finestra estricta
 * (`config.finestraConciliacioDies`) — un pagament vençut pot arribar amb
 * més retard del que es considera normal per a un pagament puntual.
 *
 * En tots dos casos, a més de compte i data, la conciliació exigeix la
 * mateixa categoria (`categoriaId`) i, si l'import del recurrent no és
 * `importAproximat`, un import EXACTAMENT igual (`importCoincideix`) — no
 * n'hi ha prou amb compte+data+import similar, ja que en un compte amb molts
 * moviments d'import semblant (p.ex. pagaments de diversos clients) això
 * conciliava falsament un compromís amb un moviment real no relacionat.
 *
 * `config` (per defecte `CONFIGURACIO_CONCILIACIO_DEFECTE`) prové de la
 * pestanya "Configuració" (especificacio.md 4.4); aquest mòdul es manté pur
 * — no llegeix ni escriu la base de dades, `db/operations.ts` és qui llegeix
 * `configuracio` i la passa aquí.
 */
export function projectaEsdeveniments(
  recurrents: RecurrentPerProjeccio[],
  movimentsPerConciliacio: MovimentPerConciliacio[],
  horitzoDies: number,
  avui: string = isoAvui(),
  config: ConfiguracioConciliacio = CONFIGURACIO_CONCILIACIO_DEFECTE,
): EsdevenimentPrevist[] {
  const dataLimit = afegeixDies(avui, horitzoDies);
  const esdeveniments: EsdevenimentPrevist[] = [];

  for (const r of recurrents) {
    if (r.periodicitat === 'unica') {
      if (r.dataPrevista > dataLimit) continue;
      const vençut = r.dataPrevista < avui;
      if (vençut) {
        if (esConciliatVencut(r, r.dataPrevista, movimentsPerConciliacio, config)) continue;
        const esdeveniment = esdevenimentVencut(r, r.dataPrevista, avui, config);
        if (r.dataFi && esdeveniment.data > r.dataFi) continue;
        esdeveniments.push(esdeveniment);
        continue;
      }
      if (r.dataFi && r.dataPrevista > r.dataFi) continue;
      if (esConciliat(r, r.dataPrevista, movimentsPerConciliacio, config)) continue;
      esdeveniments.push({
        data: r.dataPrevista,
        compteId: r.compteId,
        concepte: r.concepte,
        importCents: r.importCents,
        importAproximat: r.importAproximat,
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

    if (!finalitzat && ultimaOcurrenciaPassada && !esConciliatVencut(r, ultimaOcurrenciaPassada, movimentsPerConciliacio, config)) {
      const esdeveniment = esdevenimentVencut(r, ultimaOcurrenciaPassada, avui, config);
      if (!(r.dataFi && esdeveniment.data > r.dataFi)) {
        esdeveniments.push(esdeveniment);
      }
    }

    if (finalitzat) continue;

    while (data <= dataLimit) {
      if (r.dataFi && data > r.dataFi) break;

      if (!esConciliat(r, data, movimentsPerConciliacio, config)) {
        esdeveniments.push({
          data,
          compteId: r.compteId,
          concepte: r.concepte,
          importCents: r.importCents,
          importAproximat: r.importAproximat,
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
