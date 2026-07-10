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
  /** Marca un moviment de targeta com una retirada/disposició d'efectiu (o similar) que es cobra directament al compte corrent, sense passar per la liquidació mensual. */
  esLiquidacioDirecta?: boolean;
  /** Id del moviment amb què està aparellat com a liquidació directa. */
  aparellatAmbId?: string;
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

/** Detecta automàticament, pel concepte del propi moviment de targeta, si es tracta d'una retirada/disposició d'efectiu que s'ha de tractar com a liquidació directa. */
export interface ReglaLiquidacioDirecta {
  id: string;
  patro: string;
}

export interface SuggerimentAparellamentDirecte {
  movimentTargeta: Moviment;
  movimentCorrent: Moviment;
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
  reglesLiquidacioDirecta: ReglaLiquidacioDirecta[];
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
