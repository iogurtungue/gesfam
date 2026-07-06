export type BankId = 'sabadell' | 'bbva' | 'ing' | 'openbank' | 'altre';
export type AccountType = 'corrent' | 'targeta';

export type RawCell = string | number | Date | null | undefined;
export type RawRow = RawCell[];
export type RawTable = RawRow[];

export interface ParsedMoviment {
  dataOperacio: string; // ISO yyyy-mm-dd
  dataValor: string; // ISO yyyy-mm-dd
  concepteOriginal: string;
  importCents: number; // signed; positive = ingrés, negative = càrrec
  saldoPosteriorCents: number | null;
}

export interface ParsedAccountInfo {
  banc: BankId;
  tipus: AccountType;
  entitat?: string;
  oficina?: string;
  numeroCompte?: string;
  saldoConegutCents?: number | null;
  dataSaldoConegut?: string | null;
}

export interface ParseResult {
  compte: ParsedAccountInfo;
  moviments: ParsedMoviment[];
  warnings: string[];
}
