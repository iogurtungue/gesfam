import type { AccountType, BankId } from '../parsers/types';

export interface Compte {
  id: string;
  banc: BankId;
  tipus: AccountType;
  alias: string;
  ibanOUltimsDigits?: string;
  saldoActualConegutCents?: number;
  dataSaldoActualConegut?: string;
  /** Only for targetes: compte corrent on es liquida mensualment. */
  compteLiquidacioId?: string;
  /** Only for targetes: dia del mes de càrrec de la liquidació. */
  diaLiquidacio?: number;
}

export interface Moviment {
  id: string; // deterministic hash, spec 3.3
  compteId: string;
  dataOperacio: string;
  dataValor: string;
  concepteOriginal: string;
  concepteNormalitzat: string;
  importCents: number;
  saldoPosteriorCents: number | null;
  categoria?: string;
  lotImportacioId: string;
  esTransferenciaInterna?: boolean;
}

export interface LotImportacio {
  id: string;
  data: string; // ISO datetime de la importació
  fitxerOrigen: string;
  banc: BankId;
  compteId: string;
  nombreMoviments: number;
}
