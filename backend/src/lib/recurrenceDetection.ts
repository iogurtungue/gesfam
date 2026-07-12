import { normalizeConceptForRecurrence } from './concept';
import type { PeriodicitatRecurrent } from '../db/types';

export interface MovimentCandidat {
  id: string;
  compteId: string;
  dataOperacio: string;
  concepteOriginal: string;
  importCents: number;
}

/** Deteccio nomes produeix periodicitats repetitives; `unica` es reservada per a compromisos manuals/importats (spec 4.2). */
export type PeriodicitatDetectable = Exclude<PeriodicitatRecurrent, 'unica'>;

export interface CandidatRecurrent {
  compteId: string;
  /** Concepte original de l'ocurrència més recent, per mostrar a la revisió. */
  concepte: string;
  concepteNormalitzat: string;
  periodicitat: PeriodicitatDetectable;
  /** Cèntims amb signe (mediana de les ocurrències que formen el patró). */
  importEstimatCents: number;
  importMinCents: number;
  importMaxCents: number;
  /** Propera ocurrència esperada: sempre avui o en el futur, encara que l'última ocurrència real sigui de fa mesos (es projecta endavant període a període, mai es mostra una data ja passada). */
  dataPrevista: string;
  ocurrencies: number;
  /** 0-100: combina nombre d'ocurrències i regularitat dels intervals (spec 4.1.4). Heurística de la sub-fase 3.3, ajustable. */
  confianca: number;
  /** Ids dels moviments que formen aquest patró, per a la futura pantalla de revisió (sub-fase 3.4). */
  movimentIds: string[];
}

/** ±15% (spec 4.1.2): tolerància per considerar dues ocurrències part del mateix patró tot i variar l'import (rebuts variables com la llum). */
const TOLERANCIA_IMPORT = 0.15;

interface DefinicioPeriodicitat {
  key: PeriodicitatDetectable;
  diesCentre: number;
  toleranciaDies: number;
  minOcurrencies: number;
  /** Si està definit, la propera data es calcula afegint mesos de calendari (preservant el dia del mes); si no, afegint diesCentre dies. */
  mesos?: number;
}

const PERIODICITATS: DefinicioPeriodicitat[] = [
  { key: 'setmanal', diesCentre: 7, toleranciaDies: 2, minOcurrencies: 3 },
  { key: 'mensual', diesCentre: 30, toleranciaDies: 4, minOcurrencies: 3, mesos: 1 },
  { key: 'bimestral', diesCentre: 60, toleranciaDies: 6, minOcurrencies: 3, mesos: 2 },
  { key: 'trimestral', diesCentre: 91, toleranciaDies: 7, minOcurrencies: 3, mesos: 3 },
  { key: 'semestral', diesCentre: 182, toleranciaDies: 10, minOcurrencies: 2, mesos: 6 },
  { key: 'anual', diesCentre: 365, toleranciaDies: 15, minOcurrencies: 2, mesos: 12 },
];

function diesEntre(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return (db - da) / 86_400_000;
}

function afegeixDies(iso: string, dies: number): string {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dies);
  return data.toISOString().slice(0, 10);
}

/** Afegeix mesos de calendari preservant el dia del mes ("mateix dia del mes", spec 4.1.3), clampat a l'últim dia del mes objectiu si aquest no existeix (p. ex. 31/01 + 1 mes -> 28 o 29/02). */
function afegeixMesos(iso: string, mesos: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const totalMesos = y * 12 + (m - 1) + mesos;
  const anyObjectiu = Math.floor(totalMesos / 12);
  const mesObjectiu = ((totalMesos % 12) + 12) % 12;
  const ultimDiaMesObjectiu = new Date(Date.UTC(anyObjectiu, mesObjectiu + 1, 0)).getUTCDate();
  const diaClampat = Math.min(d, ultimDiaMesObjectiu);
  return `${anyObjectiu}-${String(mesObjectiu + 1).padStart(2, '0')}-${String(diaClampat).padStart(2, '0')}`;
}

function isoAvui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Avança `data` un període (mesos de calendari o dies, segons la periodicitat) repetidament fins que ja no quedi en el passat respecte a `avui` — la propera ocurrència prevista d'un patró ha de ser sempre una data futura (o avui), mai una que ja hauria d'haver passat perquè fa temps que no arriben moviments nous d'aquest concepte. */
function properaOcurrencia(ultimaData: string, periodicitat: DefinicioPeriodicitat, avui: string): string {
  const avanca = (data: string) => (periodicitat.mesos !== undefined ? afegeixMesos(data, periodicitat.mesos) : afegeixDies(data, periodicitat.diesCentre));
  let prevista = avanca(ultimaData);
  while (prevista < avui) {
    prevista = avanca(prevista);
  }
  return prevista;
}

/** ISO date del dia `dia` (clampat a l'últim dia si el mes no en té tants) d'un any/mes 1-indexed donats. */
function dataDelMes(any: number, mes1indexat: number, dia: number): string {
  const ultimDia = new Date(Date.UTC(any, mes1indexat, 0)).getUTCDate();
  const diaClampat = Math.min(dia, ultimDia);
  return `${any}-${String(mes1indexat).padStart(2, '0')}-${String(diaClampat).padStart(2, '0')}`;
}

/**
 * Propera data de liquidació d'una targeta al compte corrent (especificacio.md
 * 3.2.1, sub-fase 3.5): el primer `diaLiquidacio` de mes que sigui igual o
 * posterior a `dataCarrec` — si el dia de liquidació d'aquest mes ja ha
 * passat respecte al càrrec, es passa al mes següent. És la data que
 * realment afecta la tresoreria, no la data del càrrec a la targeta mateixa.
 */
export function properaDataLiquidacio(dataCarrec: string, diaLiquidacio: number): string {
  const [y, m] = dataCarrec.split('-').map(Number);
  const aquestMes = dataDelMes(y, m, diaLiquidacio);
  if (aquestMes >= dataCarrec) return aquestMes;
  const totalMesos = y * 12 + (m - 1) + 1;
  const anySeguent = Math.floor(totalMesos / 12);
  const mesSeguent = (totalMesos % 12) + 1;
  return dataDelMes(anySeguent, mesSeguent, diaLiquidacio);
}

function mediana(valors: number[]): number {
  const ordenats = [...valors].sort((a, b) => a - b);
  const mig = Math.floor(ordenats.length / 2);
  return ordenats.length % 2 === 0 ? (ordenats[mig - 1] + ordenats[mig]) / 2 : ordenats[mig];
}

/** Heurística v1: mig pes al nombre d'ocurrències (satura a partir de 6), mig pes a la regularitat dels intervals respecte al centre de la periodicitat detectada. Ajustable sense afectar la resta del motor. */
function calculaConfianca(ocurrencies: number, desviacioMitjanaDies: number, toleranciaDies: number): number {
  const regularitat = Math.max(0, 1 - desviacioMitjanaDies / toleranciaDies);
  const quantitat = Math.min(1, ocurrencies / 6);
  return Math.round(100 * (0.5 * regularitat + 0.5 * quantitat));
}

function analitzaGrup(grup: MovimentCandidat[], avui: string): CandidatRecurrent | null {
  const ordenat = [...grup].sort((a, b) => a.dataOperacio.localeCompare(b.dataOperacio));

  // Criteri secundari d'agrupació (spec 4.1.2): descarta ocurrències l'import
  // de les quals s'allunya massa de la mediana del grup (mateix concepte i
  // signe, però probablement un moviment no relacionat).
  const medianaAbsoluta = mediana(ordenat.map((m) => Math.abs(m.importCents)));
  const dinsTolerancia = ordenat.filter((m) => Math.abs(Math.abs(m.importCents) - medianaAbsoluta) <= medianaAbsoluta * TOLERANCIA_IMPORT);
  if (dinsTolerancia.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 1; i < dinsTolerancia.length; i++) {
    intervals.push(diesEntre(dinsTolerancia[i - 1].dataOperacio, dinsTolerancia[i].dataOperacio));
  }
  const intervalMedia = mediana(intervals);

  const periodicitat = PERIODICITATS.find((p) => Math.abs(intervalMedia - p.diesCentre) <= p.toleranciaDies);
  if (!periodicitat || dinsTolerancia.length < periodicitat.minOcurrencies) return null;

  const desviacioMitjana = intervals.reduce((suma, interval) => suma + Math.abs(interval - periodicitat.diesCentre), 0) / intervals.length;
  const ultim = dinsTolerancia[dinsTolerancia.length - 1];
  const importsSigned = dinsTolerancia.map((m) => m.importCents);

  return {
    compteId: ultim.compteId,
    concepte: ultim.concepteOriginal,
    concepteNormalitzat: normalizeConceptForRecurrence(ultim.concepteOriginal),
    periodicitat: periodicitat.key,
    importEstimatCents: Math.round(mediana(importsSigned)),
    importMinCents: Math.min(...importsSigned),
    importMaxCents: Math.max(...importsSigned),
    dataPrevista: properaOcurrencia(ultim.dataOperacio, periodicitat, avui),
    ocurrencies: dinsTolerancia.length,
    confianca: calculaConfianca(dinsTolerancia.length, desviacioMitjana, periodicitat.toleranciaDies),
    movimentIds: dinsTolerancia.map((m) => m.id),
  };
}

/**
 * Motor de detecció de periodicitat (spec 4.1, sub-fase 3.3): agrupa
 * moviments per (compte, concepte normalitzat per a recurrència, signe),
 * n'analitza els intervals i retorna un candidat per grup on es detecta una
 * periodicitat clara amb prou ocurrències. Pura funció de lectura — no
 * escriu res ni consulta la base de dades; el cridant (db/operations.ts) és
 * qui decideix quins moviments hi entren (només compte corrent, exclosos
 * transferències internes i contrapartides de liquidació, exclosos els que
 * ja pertanyen a un recurrent confirmat/ignorat) i qui, en una sub-fase
 * posterior (3.4), persistirà les confirmacions de l'usuari.
 *
 * `avui` (ISO, per defecte la data real) és només per fer el càlcul de la
 * propera ocurrència testejable de manera determinista — vegeu
 * `properaOcurrencia`.
 */
export function detectaRecurrents(moviments: MovimentCandidat[], avui: string = isoAvui()): CandidatRecurrent[] {
  const grups = new Map<string, MovimentCandidat[]>();
  for (const m of moviments) {
    if (m.importCents === 0) continue;
    const clau = `${m.compteId}|${normalizeConceptForRecurrence(m.concepteOriginal)}|${Math.sign(m.importCents)}`;
    const grup = grups.get(clau);
    if (grup) {
      grup.push(m);
    } else {
      grups.set(clau, [m]);
    }
  }

  const candidats: CandidatRecurrent[] = [];
  for (const grup of grups.values()) {
    const candidat = analitzaGrup(grup, avui);
    if (candidat) candidats.push(candidat);
  }
  return candidats.sort((a, b) => a.dataPrevista.localeCompare(b.dataPrevista));
}
