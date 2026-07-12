// Pure type shapes mirroring the backend's domain model and parser output
// (backend/src/db/types.ts, backend/src/parsers/types.ts). No logic here —
// all parsing/dedup/persistence now happens on the backend; the frontend
// only needs to know the shape of what the API sends/expects.

export type BankId = 'sabadell' | 'bbva' | 'ing' | 'openbank' | 'altre';
export type AccountType = 'corrent' | 'targeta';

export type RawCell = string | number | null | undefined;
export type RawRow = RawCell[];
export type RawTable = RawRow[];

export interface Compte {
  id: string;
  banc: BankId;
  tipus: AccountType;
  alias: string;
  ibanOUltimsDigits?: string;
  compteLiquidacioId?: string;
  diaLiquidacio?: number;
  ordre?: number;
  grup?: string;
}

export interface Moviment {
  id: string;
  compteId: string;
  dataOperacio: string;
  dataValor: string;
  concepteOriginal: string;
  concepteNormalitzat: string;
  importCents: number;
  saldoPosteriorCents: number | null;
  categoriaId?: string;
  lotImportacioId: string;
  esTransferenciaInterna?: boolean;
  seq: number;
  /** Si aquest moviment (d'un compte corrent) és el càrrec de liquidació mensual d'una targeta, l'id d'aquesta targeta. */
  esLiquidacioTargetaId?: string;
  /** Si aquest moviment és la contrapartida virtual generada per a una liquidació de targeta, l'id del moviment real que la va originar. */
  movimentOrigenId?: string;
}

export interface LotImportacio {
  id: string;
  data: string;
  fitxerOrigen: string;
  banc: BankId;
  compteId: string;
  nombreMoviments: number;
}

export interface Categoria {
  id: string;
  nom: string;
}

export interface ReglaCategoritzacio {
  id: string;
  patro: string;
  categoriaId: string;
  prioritat: number;
}

/** Detecta automàticament, pel concepte d'un càrrec del compte corrent, a quina targeta correspon la seva liquidació mensual. */
export interface ReglaLiquidacioTargeta {
  id: string;
  patro: string;
  targetaCompteId: string;
}

export interface SuggerimentLiquidacio {
  moviment: Moviment;
  targetaCompteId: string;
}

export interface QuadraturaLiquidacio {
  esperatCents: number;
  obtingutCents: number;
  diferenciaCents: number;
}

export interface ResultatMarcaLiquidacio {
  contrapartida: Moviment;
  quadratura: QuadraturaLiquidacio;
}

export interface ParsedMoviment {
  dataOperacio: string;
  dataValor: string;
  concepteOriginal: string;
  importCents: number;
  saldoPosteriorCents: number | null;
}

export interface ParsedAccountInfo {
  banc: BankId;
  tipus: AccountType;
  entitat?: string;
  oficina?: string;
  numeroCompte?: string;
}

export interface ParseResult {
  compte: ParsedAccountInfo;
  moviments: ParsedMoviment[];
  warnings: string[];
}

export type ImportOutcome =
  | { status: 'parsed'; results: ParseResult[] }
  | { status: 'needsMapping'; table: RawTable }
  | { status: 'error'; message: string };

/** A manual column mapping, used when automatic bank/format detection fails (spec 3.1.4). */
export interface ColumnMapping {
  banc: BankId;
  tipus: AccountType;
  headerRowIndex: number;
  dataOperacioCol: number;
  dataValorCol?: number;
  concepteCols: number[];
  importCol: number;
  saldoCol?: number;
}

export interface SuggerimentTransferencia {
  a: string;
  b: string;
}

export interface SuggerimentAmbDetall extends SuggerimentTransferencia {
  movimentA: Moviment;
  movimentB: Moviment;
}

export interface Backup {
  versio: 1;
  exportatEl: string;
  comptes: Compte[];
  moviments: Moviment[];
  lots: LotImportacio[];
  categories: Categoria[];
  regles: ReglaCategoritzacio[];
  reglesLiquidacio: ReglaLiquidacioTargeta[];
  transferenciesDescartades: SuggerimentTransferencia[];
  recurrents: Recurrent[];
}

// --- Recurrents (especificacio.md 4.1, 4.2) ---

/** `unica` = un venciment puntual, no repetitiu (p. ex. una factura de proveïdor concreta). */
export type PeriodicitatRecurrent = 'unica' | 'setmanal' | 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual';
export type OrigenRecurrent = 'detectat' | 'manual' | 'importat';
export type EstatRecurrent = 'confirmat' | 'ignorat';

export interface Recurrent {
  id: string;
  compteId: string;
  concepte: string;
  concepteNormalitzat: string;
  periodicitat: PeriodicitatRecurrent;
  importCents: number;
  /** Si l'import és una estimació (patró detectat amb variació) en lloc d'un import cert conegut. */
  importAproximat: boolean;
  dataPrevista: string;
  /** Última ocurrència esperada, opcional (p. ex. un préstec o una subscripció amb data de fi coneguda). */
  dataFi?: string;
  categoriaId?: string;
  referencia?: string;
  origen: OrigenRecurrent;
  estat: EstatRecurrent;
  /** Si aquest recurrent representa un moviment entre comptes propis (mateix concepte que `Moviment.esTransferenciaInterna`). */
  esTransferenciaInterna?: boolean;
}

/** Una fila del fitxer de compromisos confirmats (4.2), abans de resoldre la Categoria a un id. */
export interface ParsedRecurrentImport {
  concepte: string;
  importCents: number;
  dataPrevista: string;
  categoriaNom?: string;
  referencia?: string;
}

export interface PrevisualitzacioRecurrentsResult {
  recurrents: ParsedRecurrentImport[];
  warnings: string[];
}

export interface ImportaRecurrentsResult {
  nous: number;
  duplicats: number;
}

/** Payload comú per crear/confirmar/ignorar un recurrent (especificacio.md 4.1.5, sub-fases 3.1/3.4). */
export interface DadesRecurrent {
  compteId: string;
  concepte: string;
  periodicitat: PeriodicitatRecurrent;
  importCents: number;
  importAproximat?: boolean;
  dataPrevista: string;
  dataFi?: string;
  categoriaId?: string;
  referencia?: string;
  esTransferenciaInterna?: boolean;
}

export interface CommitImportResult {
  lot: LotImportacio;
  nous: number;
  duplicats: number;
}

export interface BackupFileInfo {
  filename: string;
  creatEl: string;
  midaBytes: number;
}

// --- Previsió (especificacio.md 4.3, sub-fase 4.1) ---

export interface EsdevenimentPrevist {
  data: string;
  compteId: string;
  concepte: string;
  importCents: number;
  recurrentId: string;
  categoriaId?: string;
  esTransferenciaInterna?: boolean;
  /** Només per a compromisos puntuals: la data prevista original ja havia passat i encara no s'ha conciliat, així que es mostra avui en lloc de desaparèixer. */
  vençut?: boolean;
}

export interface PuntSerieDiaria {
  data: string;
  saldoPerCompte: Record<string, number>;
  saldoTotal: number;
}

export interface Previsio {
  saldosInicials: Record<string, number>;
  esdeveniments: EsdevenimentPrevist[];
  serieDiaria: PuntSerieDiaria[];
}
