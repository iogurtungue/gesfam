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
