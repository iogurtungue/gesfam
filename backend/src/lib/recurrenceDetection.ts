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

/** Data real d'avui en ISO (getters locals, no `toISOString()` — mateix criteri que `avui()` a `frontend/src/lib/dates.ts`). Exportada perquè el cridant (db/operations.ts) pugui fer-la servir com a valor per defecte consistent per a tots els càlculs de la mateixa crida. */
export function isoAvui(): string {
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

/** El cicle de liquidació (dia `diaLiquidacio` de mes) immediatament anterior a `dataLiquidacio`. */
function cicleAnterior(dataLiquidacio: string, diaLiquidacio: number): string {
  const [y, m] = dataLiquidacio.split('-').map(Number);
  const totalMesos = y * 12 + (m - 1) - 1;
  const anyObjectiu = Math.floor(totalMesos / 12);
  const mesObjectiu = (totalMesos % 12) + 1;
  return dataDelMes(anyObjectiu, mesObjectiu, diaLiquidacio);
}

/** El cicle de liquidació (dia `diaLiquidacio` de mes) immediatament posterior a `dataLiquidacio`. */
function cicleSeguent(dataLiquidacio: string, diaLiquidacio: number): string {
  const [y, m] = dataLiquidacio.split('-').map(Number);
  const totalMesos = y * 12 + (m - 1) + 1;
  const anyObjectiu = Math.floor(totalMesos / 12);
  const mesObjectiu = (totalMesos % 12) + 1;
  return dataDelMes(anyObjectiu, mesObjectiu, diaLiquidacio);
}

/** L'última data de liquidació (dia `diaLiquidacio`) que sigui igual o anterior a `referencia`. */
function ultimaDataLiquidacio(referencia: string, diaLiquidacio: number): string {
  const [y, m] = referencia.split('-').map(Number);
  const aquestMes = dataDelMes(y, m, diaLiquidacio);
  return aquestMes <= referencia ? aquestMes : cicleAnterior(aquestMes, diaLiquidacio);
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

export interface MovimentTargetaCandidat {
  id: string;
  dataOperacio: string;
  importCents: number;
}

export interface EstimacioLiquidacioTargeta {
  /** Cèntims amb signe: mediana del total liquidat als períodes usats. */
  importEstimatCents: number;
  importMinCents: number;
  importMaxCents: number;
  /** Nombre de cicles de liquidació complets amb dades que s'han fet servir per calcular la mediana (com a mínim 2). */
  periodesUsats: number;
  /** 0-100, proporcional a `periodesUsats` sobre el màxim de cicles que es demanen (`PERIODES_PER_MITJANA`). */
  confianca: number;
  /** Propera data de liquidació (sempre futura respecte a `avui`, mai basada en moviments concrets). */
  dataPrevista: string;
  /** Ids de tots els moviments dels cicles usats, per a la futura pantalla de revisió. */
  movimentIds: string[];
}

const PERIODES_PER_MITJANA = 3;
const MINIM_PERIODES = 2;

/**
 * Estimació agregada del total de la propera liquidació d'una targeta
 * (especificacio.md 3.2.1, sub-fase 3.5 revisada): en lloc de buscar patrons
 * de repetició per comerç (massa nombrosos i irregulars per detectar-hi res
 * fiable), calcula la mediana del total liquidat als últims cicles complets
 * de facturació (com a màxim `PERIODES_PER_MITJANA`, calen com a mínim
 * `MINIM_PERIODES` amb dades). Un cicle va del dia després del `diaLiquidacio`
 * d'un mes fins al `diaLiquidacio` del mes següent. Retorna `null` si no hi
 * ha prou cicles amb moviments per fer-ne una estimació mínimament fiable.
 */
export function estimaLiquidacioTargeta(
  moviments: MovimentTargetaCandidat[],
  diaLiquidacio: number,
  avui: string = isoAvui(),
): EstimacioLiquidacioTargeta | null {
  const finalUltimCicleComplet = ultimaDataLiquidacio(avui, diaLiquidacio);

  const fronteres = [finalUltimCicleComplet];
  for (let i = 0; i < PERIODES_PER_MITJANA; i++) {
    fronteres.push(cicleAnterior(fronteres[i], diaLiquidacio));
  }

  const totalsPerPeriode: number[] = [];
  const movimentIds: string[] = [];
  for (let i = 0; i < PERIODES_PER_MITJANA; i++) {
    const inici = afegeixDies(fronteres[i + 1], 1);
    const fi = fronteres[i];
    const delPeriode = moviments.filter((m) => m.dataOperacio >= inici && m.dataOperacio <= fi);
    if (delPeriode.length === 0) continue;
    totalsPerPeriode.push(delPeriode.reduce((suma, m) => suma + m.importCents, 0));
    movimentIds.push(...delPeriode.map((m) => m.id));
  }

  if (totalsPerPeriode.length < MINIM_PERIODES) return null;

  return {
    importEstimatCents: Math.round(mediana(totalsPerPeriode)),
    importMinCents: Math.min(...totalsPerPeriode),
    importMaxCents: Math.max(...totalsPerPeriode),
    periodesUsats: totalsPerPeriode.length,
    confianca: Math.round((100 * totalsPerPeriode.length) / PERIODES_PER_MITJANA),
    dataPrevista: cicleSeguent(finalUltimCicleComplet, diaLiquidacio),
    movimentIds,
  };
}
