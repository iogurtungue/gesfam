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
  /** Si aquest moviment (d'un compte corrent) és el càrrec de liquidació mensual d'una targeta, l'id d'aquesta targeta (especificacio.md 3.2.1). */
  esLiquidacioTargetaId?: string;
  /** Si aquest moviment és la contrapartida virtual generada per a una liquidació de targeta, l'id del moviment real (compte corrent) que la va originar. */
  movimentOrigenId?: string;
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

/** Detecta automàticament, pel concepte d'un càrrec del compte corrent, a quina targeta correspon la seva liquidació mensual (especificacio.md 3.2.1). */
export interface ReglaLiquidacioTargeta {
  id: string;
  /** Subcadena a buscar dins el concepte normalitzat (comparació insensible a majúscules). */
  patro: string;
  targetaCompteId: string;
}

/** `unica` = un venciment puntual, no repetitiu (p. ex. una factura de proveïdor concreta). Les altres representen una obligació que es repeteix amb aquesta cadència (especificacio.md 4.1, 4.2). */
export type PeriodicitatRecurrent = 'unica' | 'setmanal' | 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual';

/** `detectat` = patró trobat pel motor de periodicitat sobre l'històric (sub-fase 3.3, encara no implementada); `manual`/`importat` = introduït directament per l'usuari amb import i data certs, no estimats. */
export type OrigenRecurrent = 'detectat' | 'manual' | 'importat';

/**
 * `suggerit` no s'arriba a persistir mai: un candidat detectat i encara no
 * revisat es recalcula en calent (sub-fase 3.3/3.4) i només es converteix en
 * una fila real quan l'usuari pren una decisió (confirmar o ignorar).
 */
export type EstatRecurrent = 'confirmat' | 'ignorat';

/** Compromís recurrent o puntual (especificacio.md 4.1, 4.2): patró de despesa/ingrés detectat automàticament, o compromís confirmat introduït manualment o per importació (p. ex. una factura de proveïdor amb venciment conegut). */
export interface Recurrent {
  id: string;
  compteId: string;
  /** Text tal com apareix (nom de proveïdor, descripció...). */
  concepte: string;
  concepteNormalitzat: string;
  periodicitat: PeriodicitatRecurrent;
  /** Cèntims, amb signe: negatiu = despesa, positiu = ingrés. */
  importCents: number;
  /** Si `importCents` és una estimació (p. ex. mediana d'un patró detectat amb variació entre ocurrències) en lloc d'un import cert conegut (factura, ingrés fix). Per defecte `false`; l'usuari el pot marcar/desmarcar en confirmar o corregir un recurrent. */
  importAproximat: boolean;
  /** ISO date: per a `unica`, la data de venciment; per a periodicitats repetitives, la propera ocurrència prevista (les següents es calculen a partir d'aquesta, Fase 4). */
  dataPrevista: string;
  /** ISO date opcional: última ocurrència esperada (p. ex. un préstec amb data de fi coneguda, o una subscripció que se sap que s'acabarà). Sense data de fi, el recurrent es considera indefinit. */
  dataFi?: string;
  /** Referència a Categoria.id */
  categoriaId?: string;
  /** Núm. de factura o similar, només informatiu. */
  referencia?: string;
  origen: OrigenRecurrent;
  estat: EstatRecurrent;
}
