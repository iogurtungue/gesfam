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
  /** Ordre de visualització manual (p. ex. a la pestanya de Moviments). Comptes sense ordre es mostren al final, per àlies. */
  ordre?: number;
  /** Grup opcional per organitzar els comptes a la pestanya de Comptes (p. ex. "Família", "Empresa"). */
  grup?: string;
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
  /** Referència a Categoria.id */
  categoriaId?: string;
  lotImportacioId: string;
  esTransferenciaInterna?: boolean;
  /**
   * Ordre d'inserció global i monòtonament creixent. dataOperacio per si sola
   * no desempata moviments del mateix dia — cal aquest camp per respectar
   * l'ordre en què apareixien al fitxer importat en qualsevol vista ordenada
   * per data (IndexedDB no garanteix retornar les files en ordre d'inserció).
   */
  seq: number;
}

export interface LotImportacio {
  id: string;
  data: string; // ISO datetime de la importació
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
  /** Subcadena a buscar dins el concepte normalitzat (comparació insensible a majúscules). */
  patro: string;
  categoriaId: string;
  /** Ordre d'aplicació: la primera regla que coincideix (per prioritat ascendent) guanya. */
  prioritat: number;
}
