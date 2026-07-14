import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { backupDbFile } from './backupFile.ts';
import { getDb } from './client.ts';
import { getConfiguracio } from './configuracio.ts';
import type {
  Categoria,
  Compte,
  EstatRecurrent,
  LotImportacio,
  Moviment,
  OrigenRecurrent,
  PeriodicitatRecurrent,
  Recurrent,
  ReglaCategoritzacio,
  ReglaLiquidacioTargeta,
} from './types.ts';
import { splitNousIDuplicats } from '../dedup/index.ts';
import { splitNousRecurrentsIDuplicats } from '../dedup/recurrents.ts';
import { pickCategoriaId } from '../lib/categorization.ts';
import { normalizeConceptForDedup } from '../lib/concept.ts';
import { diesEntre, isoAvui } from '../lib/dates.ts';
import { computeContrapartidaId } from '../lib/hash.ts';
import { suggereixTransferenciesInternes, type SuggerimentTransferencia } from '../lib/internalTransfers.ts';
import { pickTargetaLiquidacio } from '../lib/liquidacioTargeta.ts';
import {
  avancaPeriodicitat,
  construeixSerieDiaria,
  projectaEsdeveniments,
  type EsdevenimentPrevist,
  type MovimentPerConciliacio,
  type PuntSerieDiaria,
  type RecurrentPerProjeccio,
} from '../lib/prevision.ts';
import type { ParsedRecurrentImport } from '../parsers/recurrentsFile.ts';
import type { AccountType, BankId, ParsedMoviment } from '../parsers/types.ts';

export { actualitzaConfiguracio, getConfiguracio, type CanvisConfiguracio } from './configuracio.ts';

const DEFAULT_CATEGORIES = [
  'Habitatge',
  'Subministraments',
  'Alimentació',
  'Transport',
  'Nòmina',
  'Impostos',
  'Oci',
  'Transferències internes',
  'Altres',
];

// --- row <-> domain object mapping (snake_case SQL columns <-> camelCase TS) ---

interface CompteRow {
  id: string;
  banc: string;
  tipus: string;
  alias: string;
  iban_o_ultims_digits: string | null;
  compte_liquidacio_id: string | null;
  dia_liquidacio: number | null;
  ordre: number | null;
  grup: string | null;
}

function rowToCompte(row: CompteRow): Compte {
  return {
    id: row.id,
    banc: row.banc as BankId,
    tipus: row.tipus as AccountType,
    alias: row.alias,
    ibanOUltimsDigits: row.iban_o_ultims_digits ?? undefined,
    compteLiquidacioId: row.compte_liquidacio_id ?? undefined,
    diaLiquidacio: row.dia_liquidacio ?? undefined,
    ordre: row.ordre ?? undefined,
    grup: row.grup ?? undefined,
  };
}

interface MovimentRow {
  id: string;
  compte_id: string;
  data_operacio: string;
  data_valor: string;
  concepte_original: string;
  concepte_normalitzat: string;
  import_cents: number;
  saldo_posterior_cents: number | null;
  categoria_id: string | null;
  lot_importacio_id: string;
  es_transferencia_interna: number;
  seq: number;
  es_liquidacio_targeta_id: string | null;
  moviment_origen_id: string | null;
}

function rowToMoviment(row: MovimentRow): Moviment {
  return {
    id: row.id,
    compteId: row.compte_id,
    dataOperacio: row.data_operacio,
    dataValor: row.data_valor,
    concepteOriginal: row.concepte_original,
    concepteNormalitzat: row.concepte_normalitzat,
    importCents: row.import_cents,
    saldoPosteriorCents: row.saldo_posterior_cents,
    categoriaId: row.categoria_id ?? undefined,
    lotImportacioId: row.lot_importacio_id,
    esTransferenciaInterna: row.es_transferencia_interna === 1,
    seq: row.seq,
    esLiquidacioTargetaId: row.es_liquidacio_targeta_id ?? undefined,
    movimentOrigenId: row.moviment_origen_id ?? undefined,
  };
}

interface LotRow {
  id: string;
  data: string;
  fitxer_origen: string;
  banc: string;
  compte_id: string;
  nombre_moviments: number;
}

function rowToLot(row: LotRow): LotImportacio {
  return {
    id: row.id,
    data: row.data,
    fitxerOrigen: row.fitxer_origen,
    banc: row.banc as BankId,
    compteId: row.compte_id,
    nombreMoviments: row.nombre_moviments,
  };
}

function rowToCategoria(row: { id: string; nom: string }): Categoria {
  return { id: row.id, nom: row.nom };
}

function rowToRegla(row: { id: string; patro: string; categoria_id: string; prioritat: number }): ReglaCategoritzacio {
  return { id: row.id, patro: row.patro, categoriaId: row.categoria_id, prioritat: row.prioritat };
}

function rowToReglaLiquidacio(row: { id: string; patro: string; targeta_compte_id: string }): ReglaLiquidacioTargeta {
  return { id: row.id, patro: row.patro, targetaCompteId: row.targeta_compte_id };
}

function seguentSeq(db: DatabaseSync): number {
  const { maxSeq } = db.prepare('SELECT MAX(seq) AS maxSeq FROM moviments').get() as { maxSeq: number | null };
  return (maxSeq ?? -1) + 1;
}

function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- Comptes ---

/** Comptes sense `ordre` assignat (mai reordenats manualment) es mostren al final, per àlies. */
export function listComptes(): Compte[] {
  return (
    getDb().prepare('SELECT * FROM comptes ORDER BY ordre IS NULL, ordre, alias').all() as unknown as CompteRow[]
  ).map(rowToCompte);
}

export function createCompte(data: { banc: BankId; tipus: AccountType; alias: string; numeroCompte?: string }): Compte {
  const { seguentOrdre } = getDb().prepare('SELECT COALESCE(MAX(ordre), 0) + 1 AS seguentOrdre FROM comptes').get() as {
    seguentOrdre: number;
  };
  const compte: Compte = {
    id: randomUUID(),
    banc: data.banc,
    tipus: data.tipus,
    alias: data.alias,
    ibanOUltimsDigits: data.numeroCompte,
    ordre: seguentOrdre,
  };
  getDb()
    .prepare('INSERT INTO comptes (id, banc, tipus, alias, iban_o_ultims_digits, ordre) VALUES (?, ?, ?, ?, ?, ?)')
    .run(compte.id, compte.banc, compte.tipus, compte.alias, compte.ibanOUltimsDigits ?? null, seguentOrdre);
  return compte;
}

export function findMatchingCompte(banc: BankId, tipus: AccountType, numeroCompte?: string): Compte | undefined {
  if (!numeroCompte) return undefined;
  const row = getDb()
    .prepare('SELECT * FROM comptes WHERE banc = ? AND tipus = ? AND iban_o_ultims_digits = ?')
    .get(banc, tipus, numeroCompte) as CompteRow | undefined;
  return row ? rowToCompte(row) : undefined;
}

export interface ActualitzacioCompte {
  alias?: string;
  banc?: BankId;
  tipus?: AccountType;
  numeroCompte?: string | null;
  compteLiquidacioId?: string | null;
  diaLiquidacio?: number | null;
  ordre?: number | null;
  grup?: string | null;
}

const CAMPS_ACTUALITZACIO_COMPTE: [keyof ActualitzacioCompte, string][] = [
  ['alias', 'alias'],
  ['banc', 'banc'],
  ['tipus', 'tipus'],
  ['numeroCompte', 'iban_o_ultims_digits'],
  ['compteLiquidacioId', 'compte_liquidacio_id'],
  ['diaLiquidacio', 'dia_liquidacio'],
  ['ordre', 'ordre'],
  ['grup', 'grup'],
];

/** Edició de les dades d'un compte existent. Només toca els camps presents a `data`. */
export function actualitzaCompte(compteId: string, data: ActualitzacioCompte): void {
  if (data.compteLiquidacioId != null && !listComptes().some((c) => c.id === data.compteLiquidacioId)) {
    throw new Error('El compte de liquidació indicat no existeix.');
  }
  if (data.diaLiquidacio != null && (data.diaLiquidacio < 1 || data.diaLiquidacio > 31)) {
    throw new Error('El dia de liquidació ha de ser entre 1 i 31.');
  }

  const assignacions: string[] = [];
  const valors: unknown[] = [];
  for (const [camp, columna] of CAMPS_ACTUALITZACIO_COMPTE) {
    if (data[camp] === undefined) continue;
    assignacions.push(`${columna} = ?`);
    valors.push(data[camp] ?? null);
  }
  if (assignacions.length === 0) return;
  valors.push(compteId);
  getDb()
    .prepare(`UPDATE comptes SET ${assignacions.join(', ')} WHERE id = ?`)
    .run(...(valors as (string | number | null)[]));
}

export function countMovimentsCompte(compteId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM moviments WHERE compte_id = ?').get(compteId) as { n: number };
  return row.n;
}

/**
 * Deletes an account only if it has no associated movements — a deletion
 * that silently dropped movements would be a much bigger, less reversible
 * surprise than being told to remove them first (via the "eliminar només els
 * moviments" maintenance action). Also drops the account's own import
 * batches, which would otherwise be orphaned references to a compteId that
 * no longer exists.
 */
export function eliminaCompte(compteId: string): void {
  backupDbFile();
  const db = getDb();
  transaction(db, () => {
    if (countMovimentsCompte(compteId) > 0) {
      throw new Error('No es pot eliminar un compte que té moviments associats.');
    }
    db.prepare('DELETE FROM lots WHERE compte_id = ?').run(compteId);
    db.prepare('DELETE FROM regles_liquidacio WHERE targeta_compte_id = ?').run(compteId);
    db.prepare('DELETE FROM comptes WHERE id = ?').run(compteId);
  });
}

// --- Importació (spec 3.1, 3.3) ---

export interface CommitImportResult {
  lot: LotImportacio;
  nous: number;
  duplicats: number;
}

/**
 * Inserts the new (non-duplicate) movements for one parsed account/file into
 * a single import batch (LotImportacio), so the whole import can be undone
 * atomically later. New movements are auto-categorized against the user's
 * rules (spec 3.4) as they're inserted.
 */
export function commitImport(compte: Compte, moviments: ParsedMoviment[], fitxerOrigen: string): CommitImportResult {
  backupDbFile();
  const db = getDb();
  const existingIds = new Set(
    (db.prepare('SELECT id FROM moviments WHERE compte_id = ?').all(compte.id) as { id: string }[]).map((r) => r.id),
  );
  const { nous, duplicats } = splitNousIDuplicats(compte.banc, compte.id, moviments, existingIds);
  const regles = listRegles();
  let seguent = seguentSeq(db);

  const lot: LotImportacio = {
    id: randomUUID(),
    data: new Date().toISOString(),
    fitxerOrigen,
    banc: compte.banc,
    compteId: compte.id,
    nombreMoviments: nous.length,
  };

  transaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO moviments
        (id, compte_id, data_operacio, data_valor, concepte_original, concepte_normalitzat, import_cents, saldo_posterior_cents, categoria_id, lot_importacio_id, es_transferencia_interna, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );
    // `nous` preserves the parser's original file order, so assigning
    // strictly increasing `seq` here is what lets same-day movements sort
    // back into file order later — SQL row order isn't guaranteed either.
    for (const m of nous) {
      const concepteNormalitzat = normalizeConceptForDedup(m.concepteOriginal);
      const categoriaId = pickCategoriaId(concepteNormalitzat, regles) ?? null;
      insert.run(
        m.id,
        compte.id,
        m.dataOperacio,
        m.dataValor,
        m.concepteOriginal,
        concepteNormalitzat,
        m.importCents,
        m.saldoPosteriorCents,
        categoriaId,
        lot.id,
        seguent++,
      );
    }
    db.prepare('INSERT INTO lots (id, data, fitxer_origen, banc, compte_id, nombre_moviments) VALUES (?, ?, ?, ?, ?, ?)').run(
      lot.id,
      lot.data,
      lot.fitxerOrigen,
      lot.banc,
      lot.compteId,
      lot.nombreMoviments,
    );
  });

  return { lot, nous: nous.length, duplicats };
}

/** Removes every movement from a batch and the batch record itself (spec 3.1: undo a whole import). */
export function undoLot(lotId: string): void {
  const db = getDb();
  transaction(db, () => {
    db.prepare(
      `DELETE FROM transferencies_descartades
       WHERE moviment_a_id IN (SELECT id FROM moviments WHERE lot_importacio_id = ?)
          OR moviment_b_id IN (SELECT id FROM moviments WHERE lot_importacio_id = ?)`,
    ).run(lotId, lotId);
    db.prepare('DELETE FROM moviments WHERE lot_importacio_id = ?').run(lotId);
    db.prepare('DELETE FROM lots WHERE id = ?').run(lotId);
  });
}

export function listLots(): LotImportacio[] {
  return (getDb().prepare('SELECT * FROM lots').all() as unknown as LotRow[]).map(rowToLot);
}

export function listMovimentsPerComptes(compteIds: string[]): Moviment[] {
  if (compteIds.length === 0) return [];
  const placeholders = compteIds.map(() => '?').join(', ');
  return (getDb().prepare(`SELECT * FROM moviments WHERE compte_id IN (${placeholders})`).all(...compteIds) as unknown as MovimentRow[]).map(
    rowToMoviment,
  );
}

export function listAllMoviments(): Moviment[] {
  return (getDb().prepare('SELECT * FROM moviments').all() as unknown as MovimentRow[]).map(rowToMoviment);
}

// --- Categories i regles de categorització (spec 3.4) ---

export function listCategories(): Categoria[] {
  const categories = (getDb().prepare('SELECT * FROM categories').all() as { id: string; nom: string }[]).map(rowToCategoria);
  // No `.localeCompare(nom, 'ca')` here on purpose: an explicit locale
  // argument depends on the JS engine having full ICU data for it, which
  // isn't guaranteed (see numbers.ts's parseAmountToCents/centsToEs
  // history) — the no-arg form already sorts accented Catalan names
  // correctly and has no such dependency. Sorted in JS rather than via SQL
  // COLLATE for the same reason: SQLite's built-in collations are ASCII-only
  // and would misorder "Àlies".
  return categories.sort((a, b) => a.nom.localeCompare(b.nom));
}

export function createCategoria(nom: string): Categoria {
  const categoria: Categoria = { id: randomUUID(), nom };
  getDb().prepare('INSERT INTO categories (id, nom) VALUES (?, ?)').run(categoria.id, categoria.nom);
  return categoria;
}

export function renombraCategoria(categoriaId: string, nom: string): void {
  getDb().prepare('UPDATE categories SET nom = ? WHERE id = ?').run(nom, categoriaId);
}

export function deleteCategoria(id: string): void {
  const db = getDb();
  transaction(db, () => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    db.prepare('DELETE FROM regles WHERE categoria_id = ?').run(id);
    db.prepare('UPDATE moviments SET categoria_id = NULL WHERE categoria_id = ?').run(id);
  });
}

export function listRegles(): ReglaCategoritzacio[] {
  return (getDb().prepare('SELECT * FROM regles').all() as { id: string; patro: string; categoria_id: string; prioritat: number }[]).map(
    rowToRegla,
  );
}

function existeixCategoria(categoriaId: string): boolean {
  return getDb().prepare('SELECT 1 FROM categories WHERE id = ?').get(categoriaId) !== undefined;
}

export function createRegla(data: { patro: string; categoriaId: string; prioritat: number }): ReglaCategoritzacio {
  if (!existeixCategoria(data.categoriaId)) {
    throw new Error(`La categoria "${data.categoriaId}" no existeix.`);
  }
  const regla: ReglaCategoritzacio = { id: randomUUID(), ...data };
  getDb()
    .prepare('INSERT INTO regles (id, patro, categoria_id, prioritat) VALUES (?, ?, ?, ?)')
    .run(regla.id, regla.patro, regla.categoriaId, regla.prioritat);
  return regla;
}

export function deleteRegla(id: string): void {
  getDb().prepare('DELETE FROM regles WHERE id = ?').run(id);
}

export function actualitzaRegla(id: string, data: { patro?: string; categoriaId?: string }): void {
  if (data.categoriaId !== undefined && !existeixCategoria(data.categoriaId)) {
    throw new Error(`La categoria "${data.categoriaId}" no existeix.`);
  }
  const assignacions: string[] = [];
  const valors: string[] = [];
  if (data.patro !== undefined) {
    assignacions.push('patro = ?');
    valors.push(data.patro);
  }
  if (data.categoriaId !== undefined) {
    assignacions.push('categoria_id = ?');
    valors.push(data.categoriaId);
  }
  if (assignacions.length === 0) return;
  valors.push(id);
  getDb()
    .prepare(`UPDATE regles SET ${assignacions.join(', ')} WHERE id = ?`)
    .run(...valors);
}

export function setMovimentCategoria(movimentId: string, categoriaId: string | undefined): void {
  if (categoriaId !== undefined && !existeixCategoria(categoriaId)) {
    throw new Error(`La categoria "${categoriaId}" no existeix.`);
  }
  getDb().prepare('UPDATE moviments SET categoria_id = ? WHERE id = ?').run(categoriaId ?? null, movimentId);
}

/** Applies the current rules only to movements that don't have a category yet, so manual overrides are never clobbered. */
export function aplicaReglesAMovimentsSenseCategoria(): number {
  const db = getDb();
  const regles = listRegles();
  if (regles.length === 0) return 0;
  const senseCategoria = db.prepare('SELECT id, concepte_normalitzat FROM moviments WHERE categoria_id IS NULL').all() as {
    id: string;
    concepte_normalitzat: string;
  }[];

  let count = 0;
  transaction(db, () => {
    const update = db.prepare('UPDATE moviments SET categoria_id = ? WHERE id = ?');
    for (const m of senseCategoria) {
      const categoriaId = pickCategoriaId(m.concepte_normalitzat, regles);
      if (categoriaId !== undefined) {
        update.run(categoriaId, m.id);
        count++;
      }
    }
  });
  return count;
}

// --- Transferències internes (spec 3.4) ---

export function setTransferenciaInterna(movimentId: string, value: boolean): void {
  getDb().prepare('UPDATE moviments SET es_transferencia_interna = ? WHERE id = ?').run(value ? 1 : 0, movimentId);
}

/**
 * Elimina un únic moviment (a diferència d'undoLot, que elimina tot un lot
 * sencer). Si el moviment és el càrrec de compte corrent que liquida una
 * targeta, elimina també la seva contrapartida virtual (altrament quedaria
 * orfe, com un crèdit fantasma a la targeta). Si el moviment és la pròpia
 * contrapartida virtual, restaura l'origen a l'estat de no liquidat.
 */
export function eliminaMoviment(movimentId: string): void {
  const db = getDb();
  const moviment = obteMoviment(db, movimentId);
  if (!moviment) {
    throw new Error('El moviment indicat no existeix.');
  }

  backupDbFile();
  transaction(db, () => {
    if (moviment.esLiquidacioTargetaId) {
      db.prepare('DELETE FROM moviments WHERE moviment_origen_id = ?').run(movimentId);
    } else if (moviment.movimentOrigenId) {
      db.prepare('UPDATE moviments SET es_liquidacio_targeta_id = NULL, es_transferencia_interna = 0 WHERE id = ?').run(moviment.movimentOrigenId);
    }
    db.prepare('DELETE FROM transferencies_descartades WHERE moviment_a_id = ? OR moviment_b_id = ?').run(movimentId, movimentId);
    db.prepare('DELETE FROM moviments WHERE id = ?').run(movimentId);
  });
}

export interface SuggerimentAmbDetall extends SuggerimentTransferencia {
  movimentA: Moviment;
  movimentB: Moviment;
}

/** Clau sense ordre per identificar una parella de moviments, independentment de quin dels dos és `a` i quin `b`. */
function clauParella(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export function listTransferenciesDescartades(): SuggerimentTransferencia[] {
  return (
    getDb().prepare('SELECT moviment_a_id, moviment_b_id FROM transferencies_descartades').all() as {
      moviment_a_id: string;
      moviment_b_id: string;
    }[]
  ).map((r) => ({ a: r.moviment_a_id, b: r.moviment_b_id }));
}

/** Suggests candidate internal-transfer pairs across all accounts, for the user to confirm (spec 3.4). */
export function suggereixTransferencies(): SuggerimentAmbDetall[] {
  const moviments = listAllMoviments().filter((m) => !m.esTransferenciaInterna);
  const perId = new Map(moviments.map((m) => [m.id, m]));
  const descartades = new Set(listTransferenciesDescartades().map((t) => clauParella(t.a, t.b)));
  const suggeriments = suggereixTransferenciesInternes(
    moviments.map((m) => ({ id: m.id, compteId: m.compteId, dataOperacio: m.dataOperacio, importCents: m.importCents })),
    getConfiguracio().diesDiferenciaTransferencies,
  ).filter((s) => !descartades.has(clauParella(s.a, s.b)));
  return suggeriments.map((s) => ({ ...s, movimentA: perId.get(s.a)!, movimentB: perId.get(s.b)! }));
}

export function confirmaTransferencia(suggeriment: SuggerimentTransferencia): void {
  const db = getDb();
  transaction(db, () => {
    db.prepare('UPDATE moviments SET es_transferencia_interna = 1 WHERE id = ?').run(suggeriment.a);
    db.prepare('UPDATE moviments SET es_transferencia_interna = 1 WHERE id = ?').run(suggeriment.b);
  });
}

/** Descarta un suggeriment de transferència interna (falsa alarma): no torna a aparèixer a suggereixTransferencies, sense marcar els moviments com a transferència interna. */
export function descartaTransferencia(suggeriment: SuggerimentTransferencia): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO transferencies_descartades (id, moviment_a_id, moviment_b_id) VALUES (?, ?, ?)')
    .run(clauParella(suggeriment.a, suggeriment.b), suggeriment.a, suggeriment.b);
}

// --- Liquidacions de targeta (especificacio.md 3.2.1) ---
//
// Els extractes de targeta mai inclouen la seva pròpia liquidació mensual —
// només apareix com un càrrec al compte corrent — així que el "saldo" d'una
// targeta (suma d'import_cents, veure balance.ts al frontend) creixeria
// indefinidament sense una contrapartida. Marcar el càrrec del compte corrent
// com la liquidació d'una targeta crea automàticament un moviment virtual a
// la targeta (import positiu, mateix import en valor absolut) que cancel·la
// el deute acumulat des de l'anterior liquidació.

export function listReglesLiquidacio(): ReglaLiquidacioTargeta[] {
  return (
    getDb().prepare('SELECT * FROM regles_liquidacio').all() as { id: string; patro: string; targeta_compte_id: string }[]
  ).map(rowToReglaLiquidacio);
}

function existeixTargeta(compteId: string): boolean {
  const row = getDb().prepare('SELECT tipus FROM comptes WHERE id = ?').get(compteId) as { tipus: string } | undefined;
  return row?.tipus === 'targeta';
}

export function createReglaLiquidacio(data: { patro: string; targetaCompteId: string }): ReglaLiquidacioTargeta {
  if (!existeixTargeta(data.targetaCompteId)) {
    throw new Error('El compte de targeta indicat no existeix.');
  }
  const regla: ReglaLiquidacioTargeta = { id: randomUUID(), ...data };
  getDb()
    .prepare('INSERT INTO regles_liquidacio (id, patro, targeta_compte_id) VALUES (?, ?, ?)')
    .run(regla.id, regla.patro, regla.targetaCompteId);
  return regla;
}

export function deleteReglaLiquidacio(id: string): void {
  getDb().prepare('DELETE FROM regles_liquidacio WHERE id = ?').run(id);
}

export interface SuggerimentLiquidacio {
  moviment: Moviment;
  targetaCompteId: string;
}

/** Proposes, per a cada càrrec del compte corrent encara sense marcar, a quina targeta correspondria segons les regles configurades — per confirmar manualment (mateix patró que suggereixTransferencies). */
export function suggereixLiquidacionsTargeta(): SuggerimentLiquidacio[] {
  const regles = listReglesLiquidacio();
  if (regles.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT m.* FROM moviments m
       JOIN comptes c ON c.id = m.compte_id
       WHERE c.tipus = 'corrent' AND m.es_liquidacio_targeta_id IS NULL AND m.moviment_origen_id IS NULL`,
    )
    .all() as unknown as MovimentRow[];

  const suggeriments: SuggerimentLiquidacio[] = [];
  for (const row of rows) {
    const moviment = rowToMoviment(row);
    const targetaCompteId = pickTargetaLiquidacio(moviment.concepteNormalitzat, regles);
    if (targetaCompteId) suggeriments.push({ moviment, targetaCompteId });
  }
  return suggeriments;
}

function obteMoviment(db: DatabaseSync, id: string): Moviment | undefined {
  const row = db.prepare('SELECT * FROM moviments WHERE id = ?').get(id) as MovimentRow | undefined;
  return row ? rowToMoviment(row) : undefined;
}

/** Elimina la contrapartida virtual (si n'hi ha) i desfà el marcatge, sense obrir la seva pròpia transacció (perquè marcaLiquidacioTargeta la pugui reutilitzar abans de tornar a marcar). */
function desmarcaLiquidacioTargetaSenseTransaccio(db: DatabaseSync, movimentCorrentId: string): void {
  db.prepare('DELETE FROM moviments WHERE moviment_origen_id = ?').run(movimentCorrentId);
  db.prepare('UPDATE moviments SET es_liquidacio_targeta_id = NULL, es_transferencia_interna = 0 WHERE id = ?').run(movimentCorrentId);
}

export function desmarcaLiquidacioTargeta(movimentCorrentId: string): void {
  const db = getDb();
  transaction(db, () => desmarcaLiquidacioTargetaSenseTransaccio(db, movimentCorrentId));
}

export interface QuadraturaLiquidacio {
  /** Suma (en valor absolut) dels moviments reals de la targeta des de l'anterior liquidació fins a la data d'aquesta. */
  esperatCents: number;
  /** Import (en valor absolut) del càrrec de liquidació marcat. */
  obtingutCents: number;
  /** obtingutCents - esperatCents; diferent de 0 si la liquidació no quadra amb els moviments de la targeta. */
  diferenciaCents: number;
}

export interface ResultatMarcaLiquidacio {
  contrapartida: Moviment;
  quadratura: QuadraturaLiquidacio;
}

/**
 * Marca un moviment del compte corrent com la liquidació mensual d'una
 * targeta: el marca com a transferència interna i crea el seu moviment
 * virtual de contrapartida a la targeta (id determinista, veure
 * computeContrapartidaId — reimportar el mateix càrrec i tornar a marcar-lo
 * reprodueix exactament la mateixa contrapartida en lloc de duplicar-la).
 * També calcula la quadratura: si l'import liquidat no coincideix amb la
 * suma dels moviments reals de la targeta des de l'anterior liquidació, el
 * resultat ho reflecteix perquè la UI ho pugui avisar (no bloquejant).
 */
export function marcaLiquidacioTargeta(movimentCorrentId: string, targetaCompteId: string): ResultatMarcaLiquidacio {
  const db = getDb();
  const moviment = obteMoviment(db, movimentCorrentId);
  if (!moviment) {
    throw new Error('El moviment indicat no existeix.');
  }
  if (moviment.movimentOrigenId) {
    throw new Error('Aquest moviment ja és una contrapartida automàtica; no es pot marcar com a liquidació.');
  }
  const compteOrigen = getDb().prepare('SELECT tipus FROM comptes WHERE id = ?').get(moviment.compteId) as
    | { tipus: string }
    | undefined;
  if (compteOrigen?.tipus !== 'corrent') {
    throw new Error("Només es pot marcar com a liquidació un moviment d'un compte corrent.");
  }
  if (!existeixTargeta(targetaCompteId)) {
    throw new Error('El compte de targeta indicat no existeix.');
  }

  backupDbFile();
  let resultat!: ResultatMarcaLiquidacio;
  transaction(db, () => {
    desmarcaLiquidacioTargetaSenseTransaccio(db, movimentCorrentId);

    db.prepare('UPDATE moviments SET es_liquidacio_targeta_id = ?, es_transferencia_interna = 1 WHERE id = ?').run(
      targetaCompteId,
      movimentCorrentId,
    );

    const anterior = db
      .prepare(
        `SELECT data_operacio FROM moviments
         WHERE es_liquidacio_targeta_id = ? AND id != ? AND data_operacio < ?
         ORDER BY data_operacio DESC LIMIT 1`,
      )
      .get(targetaCompteId, movimentCorrentId, moviment.dataOperacio) as { data_operacio: string } | undefined;
    const desDe = anterior?.data_operacio ?? '0000-00-00';
    const { suma } = db
      .prepare(
        `SELECT COALESCE(SUM(import_cents), 0) AS suma FROM moviments
         WHERE compte_id = ? AND moviment_origen_id IS NULL AND data_operacio > ? AND data_operacio <= ?`,
      )
      .get(targetaCompteId, desDe, moviment.dataOperacio) as { suma: number };

    const esperatCents = Math.abs(suma);
    const obtingutCents = Math.abs(moviment.importCents);

    const concepteOriginal = 'Liquidació rebuda (contrapartida automàtica)';
    const contrapartida: Moviment = {
      id: computeContrapartidaId(movimentCorrentId),
      compteId: targetaCompteId,
      dataOperacio: moviment.dataOperacio,
      dataValor: moviment.dataOperacio,
      concepteOriginal,
      concepteNormalitzat: normalizeConceptForDedup(concepteOriginal),
      importCents: obtingutCents,
      saldoPosteriorCents: null,
      lotImportacioId: moviment.lotImportacioId,
      esTransferenciaInterna: true,
      movimentOrigenId: movimentCorrentId,
      seq: seguentSeq(db),
    };
    db.prepare(
      `INSERT INTO moviments
        (id, compte_id, data_operacio, data_valor, concepte_original, concepte_normalitzat, import_cents, saldo_posterior_cents, categoria_id, lot_importacio_id, es_transferencia_interna, seq, moviment_origen_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
    ).run(
      contrapartida.id,
      contrapartida.compteId,
      contrapartida.dataOperacio,
      contrapartida.dataValor,
      contrapartida.concepteOriginal,
      contrapartida.concepteNormalitzat,
      contrapartida.importCents,
      contrapartida.saldoPosteriorCents,
      contrapartida.lotImportacioId,
      contrapartida.seq,
      movimentCorrentId,
    );

    resultat = {
      contrapartida,
      quadratura: { esperatCents, obtingutCents, diferenciaCents: obtingutCents - esperatCents },
    };
  });

  return resultat;
}

// --- Recurrents (especificacio.md 4.1, 4.2) ---
//
// Un recurrent és, indistintament, un patró detectat automàticament sobre
// l'històric (origen='detectat', motor de detecció de la sub-fase 3.3,
// encara no implementat) o un compromís confirmat introduït per l'usuari,
// manualment o per importació (origen='manual'/'importat'; periodicitat
// 'unica' per a un venciment puntual no repetitiu, p. ex. una factura de
// proveïdor concreta). Aquesta sub-fase (3.1) només cobreix el model i el
// manteniment manual (llistar, crear, eliminar); la importació de fitxers
// (3.2) i el motor de detecció (3.3) són sub-fases posteriors.

interface RecurrentRow {
  id: string;
  compte_id: string;
  concepte: string;
  concepte_normalitzat: string;
  periodicitat: string;
  import_cents: number;
  import_aproximat: number;
  data_prevista: string;
  data_fi: string | null;
  categoria_id: string | null;
  referencia: string | null;
  origen: string;
  estat: string;
  es_transferencia_interna: number;
}

function rowToRecurrent(row: RecurrentRow): Recurrent {
  return {
    id: row.id,
    compteId: row.compte_id,
    concepte: row.concepte,
    concepteNormalitzat: row.concepte_normalitzat,
    periodicitat: row.periodicitat as PeriodicitatRecurrent,
    importCents: row.import_cents,
    importAproximat: row.import_aproximat === 1,
    dataPrevista: row.data_prevista,
    dataFi: row.data_fi ?? undefined,
    categoriaId: row.categoria_id ?? undefined,
    referencia: row.referencia ?? undefined,
    origen: row.origen as OrigenRecurrent,
    estat: row.estat as EstatRecurrent,
    esTransferenciaInterna: row.es_transferencia_interna === 1,
  };
}

function existeixCompte(compteId: string): boolean {
  return getDb().prepare('SELECT 1 FROM comptes WHERE id = ?').get(compteId) !== undefined;
}

export function listRecurrents(): Recurrent[] {
  return (getDb().prepare('SELECT * FROM recurrents').all() as unknown as RecurrentRow[]).map(rowToRecurrent);
}

export interface DadesRecurrent {
  compteId: string;
  concepte: string;
  periodicitat: PeriodicitatRecurrent;
  importCents: number;
  /** Si l'import és una estimació (patró detectat amb variació) en lloc d'un import real. Per defecte `false`. */
  importAproximat?: boolean;
  dataPrevista: string;
  /** Última ocurrència esperada, opcional (p. ex. un préstec o una subscripció amb data de fi coneguda). */
  dataFi?: string;
  categoriaId?: string;
  referencia?: string;
  /** Si aquest recurrent representa un moviment entre comptes propis. Per defecte `false`. */
  esTransferenciaInterna?: boolean;
}

function inserirRecurrent(data: DadesRecurrent, origen: OrigenRecurrent, estat: EstatRecurrent): Recurrent {
  if (!existeixCompte(data.compteId)) {
    throw new Error('El compte indicat no existeix.');
  }
  if (data.categoriaId !== undefined && !existeixCategoria(data.categoriaId)) {
    throw new Error(`La categoria "${data.categoriaId}" no existeix.`);
  }
  const recurrent: Recurrent = {
    id: randomUUID(),
    compteId: data.compteId,
    concepte: data.concepte,
    concepteNormalitzat: normalizeConceptForDedup(data.concepte),
    periodicitat: data.periodicitat,
    importCents: data.importCents,
    importAproximat: data.importAproximat ?? false,
    dataPrevista: data.dataPrevista,
    dataFi: data.dataFi,
    categoriaId: data.categoriaId,
    referencia: data.referencia,
    origen,
    estat,
    esTransferenciaInterna: data.esTransferenciaInterna ?? false,
  };
  getDb()
    .prepare(
      `INSERT INTO recurrents
        (id, compte_id, concepte, concepte_normalitzat, periodicitat, import_cents, import_aproximat, data_prevista, data_fi, categoria_id, referencia, origen, estat, es_transferencia_interna)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      recurrent.id,
      recurrent.compteId,
      recurrent.concepte,
      recurrent.concepteNormalitzat,
      recurrent.periodicitat,
      recurrent.importCents,
      recurrent.importAproximat ? 1 : 0,
      recurrent.dataPrevista,
      recurrent.dataFi ?? null,
      recurrent.categoriaId ?? null,
      recurrent.referencia ?? null,
      recurrent.origen,
      recurrent.estat,
      recurrent.esTransferenciaInterna ? 1 : 0,
    );
  return recurrent;
}

/** Crea un recurrent manual (spec 4.1.5: "afegir manualment recurrents que l'algorisme no ha vist"), sempre confirmat directament — l'usuari ja n'ha decidit conscientment l'import i la data. */
export function creaRecurrentManual(data: DadesRecurrent): Recurrent {
  return inserirRecurrent(data, 'manual', 'confirmat');
}

/** Corregeix un recurrent ja existent (manual, importat o confirmat des d'un candidat) — spec 4.1.5 "corregir". Recalcula concepteNormalitzat si el concepte canvia. */
export function actualitzaRecurrent(
  id: string,
  data: Partial<{
    compteId: string;
    concepte: string;
    periodicitat: PeriodicitatRecurrent;
    importCents: number;
    importAproximat: boolean;
    dataPrevista: string;
    dataFi: string | null;
    categoriaId: string | null;
    referencia: string | null;
    esTransferenciaInterna: boolean;
  }>,
): void {
  if (!getDb().prepare('SELECT 1 FROM recurrents WHERE id = ?').get(id)) {
    throw new Error('El recurrent indicat no existeix.');
  }
  if (data.compteId !== undefined && !existeixCompte(data.compteId)) {
    throw new Error(`El compte "${data.compteId}" no existeix.`);
  }
  if (data.categoriaId != null && !existeixCategoria(data.categoriaId)) {
    throw new Error(`La categoria "${data.categoriaId}" no existeix.`);
  }

  const assignacions: string[] = [];
  const valors: (string | number | null)[] = [];
  if (data.compteId !== undefined) {
    assignacions.push('compte_id = ?');
    valors.push(data.compteId);
  }
  if (data.concepte !== undefined) {
    assignacions.push('concepte = ?', 'concepte_normalitzat = ?');
    valors.push(data.concepte, normalizeConceptForDedup(data.concepte));
  }
  if (data.periodicitat !== undefined) {
    assignacions.push('periodicitat = ?');
    valors.push(data.periodicitat);
  }
  if (data.importCents !== undefined) {
    assignacions.push('import_cents = ?');
    valors.push(data.importCents);
  }
  if (data.importAproximat !== undefined) {
    assignacions.push('import_aproximat = ?');
    valors.push(data.importAproximat ? 1 : 0);
  }
  if (data.dataPrevista !== undefined) {
    assignacions.push('data_prevista = ?');
    valors.push(data.dataPrevista);
  }
  if (data.dataFi !== undefined) {
    assignacions.push('data_fi = ?');
    valors.push(data.dataFi);
  }
  if (data.categoriaId !== undefined) {
    assignacions.push('categoria_id = ?');
    valors.push(data.categoriaId);
  }
  if (data.referencia !== undefined) {
    assignacions.push('referencia = ?');
    valors.push(data.referencia);
  }
  if (data.esTransferenciaInterna !== undefined) {
    assignacions.push('es_transferencia_interna = ?');
    valors.push(data.esTransferenciaInterna ? 1 : 0);
  }
  if (assignacions.length === 0) return;
  valors.push(id);
  getDb()
    .prepare(`UPDATE recurrents SET ${assignacions.join(', ')} WHERE id = ?`)
    .run(...valors);
}

export function eliminaRecurrent(id: string): void {
  if (!getDb().prepare('SELECT 1 FROM recurrents WHERE id = ?').get(id)) {
    throw new Error('El recurrent indicat no existeix.');
  }
  backupDbFile();
  getDb().prepare('DELETE FROM recurrents WHERE id = ?').run(id);
}

/**
 * Descarta una ocurrència concreta prevista a la pestanya de Previsió
 * (especificacio.md 4.3): per a un compromís puntual (`unica`), l'única
 * ocurrència que tindrà mai és aquesta, així que descartar-la equival a
 * eliminar el recurrent sencer. Per a un recurrent periòdic, en canvi, el
 * recurrent ha de continuar existint per a les properes ocurrències — només
 * s'avança `dataPrevista` a la propera repetició després de `dataOcurrencia`
 * (no necessàriament la `dataPrevista` desada, que pot estar desfasada).
 */
export function eliminaOcurrenciaPrevista(recurrentId: string, dataOcurrencia: string): void {
  const row = getDb().prepare('SELECT * FROM recurrents WHERE id = ?').get(recurrentId) as RecurrentRow | undefined;
  if (!row) {
    throw new Error('El recurrent indicat no existeix.');
  }
  const { periodicitat } = rowToRecurrent(row);

  if (periodicitat === 'unica') {
    eliminaRecurrent(recurrentId);
    return;
  }

  backupDbFile();
  const novaDataPrevista = avancaPeriodicitat(dataOcurrencia, periodicitat);
  getDb().prepare('UPDATE recurrents SET data_prevista = ? WHERE id = ?').run(novaDataPrevista, recurrentId);
}

export interface ImportaRecurrentsResult {
  nous: number;
  eliminats: number;
}

/**
 * Importa un lot de compromisos confirmats (sub-fase 3.2, especificacio.md
 * 4.2): sempre periodicitat 'unica' (un venciment puntual, p. ex. una
 * factura concreta) i origen 'importat', confirmats directament.
 *
 * Cada importació reflecteix l'estat actualitzat de compromisos pendents
 * (p. ex. un llistat de factures pendents de cobrament/pagament): abans
 * d'inserir els nous, s'eliminen TOTS els recurrents amb origen='importat'
 * d'aquest mateix compte, encara que no coincideixin amb cap fila del
 * fitxer actual — un compromís que ja no hi surt es considera resolt o
 * retirat i no ha de quedar penjat a la previsió. Els recurrents manuals
 * (origen='manual') d'aquest compte no es toquen mai.
 *
 * Dins del mateix fitxer, dues files coincidents (mateix import/data/concepte)
 * es mantenen com a files separades, no es col·lapsen (splitNousRecurrentsIDuplicats,
 * spec 3.3). La categoria s'assigna per nom (comparació insensible a
 * majúscules); si no coincideix amb cap categoria existent, es queda sense.
 */
export function importaRecurrents(compteId: string, parsed: ParsedRecurrentImport[]): ImportaRecurrentsResult {
  if (!existeixCompte(compteId)) {
    throw new Error('El compte indicat no existeix.');
  }

  const db = getDb();
  const { nous } = splitNousRecurrentsIDuplicats(compteId, parsed, new Set());
  const { n: eliminats } = db
    .prepare("SELECT COUNT(*) as n FROM recurrents WHERE compte_id = ? AND origen = 'importat'")
    .get(compteId) as { n: number };

  if (eliminats > 0 || nous.length > 0) {
    backupDbFile();
    const categoriesPerNom = new Map(listCategories().map((c) => [c.nom.toLowerCase(), c.id]));
    transaction(db, () => {
      db.prepare("DELETE FROM recurrents WHERE compte_id = ? AND origen = 'importat'").run(compteId);
      const insert = db.prepare(
        `INSERT INTO recurrents
          (id, compte_id, concepte, concepte_normalitzat, periodicitat, import_cents, data_prevista, categoria_id, referencia, origen, estat)
         VALUES (?, ?, ?, ?, 'unica', ?, ?, ?, ?, 'importat', 'confirmat')`,
      );
      for (const r of nous) {
        const categoriaId = r.categoriaNom ? categoriesPerNom.get(r.categoriaNom.toLowerCase()) : undefined;
        insert.run(
          r.id,
          compteId,
          r.concepte,
          normalizeConceptForDedup(r.concepte),
          r.importCents,
          r.dataPrevista,
          categoriaId ?? null,
          r.referencia ?? null,
        );
      }
    });
  }

  return { nous: nous.length, eliminats };
}

// --- Motor de previsió (especificacio.md 4.3, sub-fase 4.1) ---

export interface Previsio {
  saldosInicials: Record<string, number>;
  esdeveniments: EsdevenimentPrevist[];
  serieDiaria: PuntSerieDiaria[];
}

/**
 * Saldo actual per compte a partir de moviments ja importats, amb SQL simple
 * (sense reproduir la lògica d'ordenació/desempat del frontend per a targetes
 * amb moviments del mateix dia, innecessària aquí: la suma és independent de
 * l'ordre). Targetes: suma de tots els moviments (deute acumulat, sense saldo
 * bancari propi). Comptes corrent: `saldoPosteriorCents` del moviment amb la
 * `(dataOperacio, seq)` més recent — `seq` és estrictament creixent en ordre
 * d'importació i el saldo posterior és informat pel banc, no inferit.
 */
function calculaSaldosActuals(comptes: Compte[]): Record<string, number> {
  const db = getDb();
  const saldos: Record<string, number> = {};
  for (const compte of comptes) {
    if (compte.tipus === 'targeta') {
      const { total } = db.prepare('SELECT COALESCE(SUM(import_cents), 0) AS total FROM moviments WHERE compte_id = ?').get(compte.id) as {
        total: number;
      };
      saldos[compte.id] = total;
    } else {
      const row = db
        .prepare('SELECT saldo_posterior_cents FROM moviments WHERE compte_id = ? ORDER BY data_operacio DESC, seq DESC LIMIT 1')
        .get(compte.id) as { saldo_posterior_cents: number | null } | undefined;
      saldos[compte.id] = row?.saldo_posterior_cents ?? 0;
    }
  }
  return saldos;
}

/**
 * Data efectiva d'"avui" per al motor de previsió (especificacio.md 4.3): en
 * lloc de la data real, es fa servir la data de l'últim moviment importat de
 * cada compte seleccionat (la més antiga entre tots, si n'hi ha diversos),
 * perquè la previsió tingui sentit encara que les dades del compte no
 * estiguin actualitzades a dia d'avui — els dies entre l'última importació i
 * avui passen a formar part de la projecció en lloc de quedar buits. Un
 * compte sense cap moviment importat encara aporta la data real d'avui (no
 * hi ha cap referència més antiga possible per a ell).
 */
function calculaAvuiPrevisio(comptes: Compte[]): string {
  const avuiReal = isoAvui();
  const db = getDb();
  const datesPerCompte = comptes.map((c) => {
    const row = db.prepare('SELECT MAX(data_operacio) AS data FROM moviments WHERE compte_id = ?').get(c.id) as { data: string | null };
    return row.data ?? avuiReal;
  });
  return datesPerCompte.reduce((min, data) => (data < min ? data : min), avuiReal);
}

export function calculaPrevisio(compteIds: string[], horitzoDies: number, avui?: string): Previsio {
  const comptes = listComptes().filter((c) => compteIds.includes(c.id));
  if (comptes.length === 0) return { saldosInicials: {}, esdeveniments: [], serieDiaria: [] };

  // L'horitzó (30/60/90 dies, 1 any) sempre es compta a partir d'AVUI DE
  // VERITAT (`avuiReal`), mai de l'àncora per compte (última importació):
  // si no, un compte amb dades desactualitzades retallaria l'horitzó abans
  // d'hora i faria desaparèixer moviments propers només perquè aquell compte
  // fa temps que no s'importa.
  const avuiReal = avui ?? isoAvui();
  const avuiCompartit = avui ?? calculaAvuiPrevisio(comptes);
  const configuracio = getConfiguracio();
  const configConciliacio = {
    finestraConciliacioDies: configuracio.finestraConciliacioDies,
    toleranciaImportConciliacio: configuracio.toleranciaImportConciliacio,
    diesDesplacamentVencut: configuracio.diesDesplacamentVencut,
    finestraResolucioVencutDies: configuracio.finestraResolucioVencutDies,
  };

  const saldosInicials = calculaSaldosActuals(comptes);

  const recurrents: RecurrentPerProjeccio[] = listRecurrents()
    .filter((r) => r.estat === 'confirmat' && compteIds.includes(r.compteId))
    .map((r) => ({
      id: r.id,
      compteId: r.compteId,
      concepte: r.concepte,
      periodicitat: r.periodicitat,
      importCents: r.importCents,
      importAproximat: r.importAproximat,
      dataPrevista: r.dataPrevista,
      dataFi: r.dataFi,
      categoriaId: r.categoriaId,
      esTransferenciaInterna: r.esTransferenciaInterna,
    }));

  const movimentsPerConciliacio: MovimentPerConciliacio[] = listMovimentsPerComptes(compteIds)
    .filter((m) => !m.esTransferenciaInterna)
    .map((m) => ({ compteId: m.compteId, dataOperacio: m.dataOperacio, importCents: m.importCents, categoriaId: m.categoriaId }));

  // Cada compte projecta els seus propis recurrents amb la seva pròpia data
  // d'"avui" (o l'`avui` explícit, si se n'ha passat un) — mai la compartida
  // de tota la selecció — perquè si un compte és vençut o no, i on es
  // desplaça, no depengui de si un altre compte sense cap relació té dades
  // més velles o més noves seleccionat alhora.
  const esdeveniments = comptes
    .flatMap((c) =>
      projectaEsdeveniments(
        recurrents.filter((r) => r.compteId === c.id),
        movimentsPerConciliacio,
        horitzoDies,
        avui ?? calculaAvuiPrevisio([c]),
        configConciliacio,
        avuiReal,
      ),
    )
    .sort((a, b) => a.data.localeCompare(b.data) || a.compteId.localeCompare(b.compteId));

  // La sèrie diària parteix de la mateixa àncora compartida que abans
  // (`avuiCompartit`, per mostrar l'evolució des d'allà), però ha d'arribar
  // fins al mateix límit real que els esdeveniments (`avuiReal + horitzoDies`),
  // no només `horitzoDies` dies des de l'àncora si aquesta és anterior.
  const diesSerie = diesEntre(avuiCompartit, avuiReal) + horitzoDies;
  const serieDiaria = construeixSerieDiaria(saldosInicials, esdeveniments, diesSerie, avuiCompartit);

  return { saldosInicials, esdeveniments, serieDiaria };
}

// --- Còpia de seguretat (NFR secció 2) ---

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

export function exportaCopiaSeguretat(): Backup {
  return {
    versio: 1,
    exportatEl: new Date().toISOString(),
    comptes: listComptes(),
    moviments: listAllMoviments(),
    lots: listLots(),
    categories: (getDb().prepare('SELECT * FROM categories').all() as { id: string; nom: string }[]).map(rowToCategoria),
    regles: listRegles(),
    reglesLiquidacio: listReglesLiquidacio(),
    transferenciesDescartades: listTransferenciesDescartades(),
    recurrents: listRecurrents(),
  };
}

/** Replaces all local data with the backup's contents. Destructive by design — the whole point is restoring a clean copy. */
export function importaCopiaSeguretat(backup: Backup): void {
  backupDbFile();
  const db = getDb();
  transaction(db, () => {
    db.exec(
      'DELETE FROM recurrents; DELETE FROM transferencies_descartades; DELETE FROM moviments; DELETE FROM lots; DELETE FROM regles; DELETE FROM regles_liquidacio; DELETE FROM categories; DELETE FROM comptes;',
    );

    const insertCompte = db.prepare(
      'INSERT INTO comptes (id, banc, tipus, alias, iban_o_ultims_digits, compte_liquidacio_id, dia_liquidacio, ordre, grup) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const c of backup.comptes) {
      insertCompte.run(
        c.id,
        c.banc,
        c.tipus,
        c.alias,
        c.ibanOUltimsDigits ?? null,
        c.compteLiquidacioId ?? null,
        c.diaLiquidacio ?? null,
        c.ordre ?? null,
        c.grup ?? null,
      );
    }

    const insertCategoria = db.prepare('INSERT INTO categories (id, nom) VALUES (?, ?)');
    for (const cat of backup.categories) insertCategoria.run(cat.id, cat.nom);

    const insertRegla = db.prepare('INSERT INTO regles (id, patro, categoria_id, prioritat) VALUES (?, ?, ?, ?)');
    for (const r of backup.regles) insertRegla.run(r.id, r.patro, r.categoriaId, r.prioritat);

    const insertReglaLiquidacio = db.prepare('INSERT INTO regles_liquidacio (id, patro, targeta_compte_id) VALUES (?, ?, ?)');
    // `reglesLiquidacio` no existia en còpies de seguretat anteriors a aquesta funcionalitat.
    for (const r of backup.reglesLiquidacio ?? []) insertReglaLiquidacio.run(r.id, r.patro, r.targetaCompteId);

    const insertLot = db.prepare('INSERT INTO lots (id, data, fitxer_origen, banc, compte_id, nombre_moviments) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of backup.lots) insertLot.run(l.id, l.data, l.fitxerOrigen, l.banc, l.compteId, l.nombreMoviments);

    const insertMoviment = db.prepare(
      `INSERT INTO moviments
        (id, compte_id, data_operacio, data_valor, concepte_original, concepte_normalitzat, import_cents, saldo_posterior_cents, categoria_id, lot_importacio_id, es_transferencia_interna, seq, es_liquidacio_targeta_id, moviment_origen_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of backup.moviments) {
      insertMoviment.run(
        m.id,
        m.compteId,
        m.dataOperacio,
        m.dataValor,
        m.concepteOriginal,
        m.concepteNormalitzat,
        m.importCents,
        m.saldoPosteriorCents,
        m.categoriaId ?? null,
        m.lotImportacioId,
        m.esTransferenciaInterna ? 1 : 0,
        m.seq,
        m.esLiquidacioTargetaId ?? null,
        m.movimentOrigenId ?? null,
      );
    }

    const insertDescartada = db.prepare('INSERT OR IGNORE INTO transferencies_descartades (id, moviment_a_id, moviment_b_id) VALUES (?, ?, ?)');
    // `transferenciesDescartades` no existia en còpies de seguretat anteriors a aquesta funcionalitat.
    for (const t of backup.transferenciesDescartades ?? []) insertDescartada.run(clauParella(t.a, t.b), t.a, t.b);

    const insertRecurrent = db.prepare(
      `INSERT INTO recurrents
        (id, compte_id, concepte, concepte_normalitzat, periodicitat, import_cents, import_aproximat, data_prevista, data_fi, categoria_id, referencia, origen, estat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // `recurrents` no existia en còpies de seguretat anteriors a aquesta funcionalitat; `importAproximat`/`dataFi` tampoc.
    for (const r of backup.recurrents ?? []) {
      insertRecurrent.run(
        r.id,
        r.compteId,
        r.concepte,
        r.concepteNormalitzat,
        r.periodicitat,
        r.importCents,
        r.importAproximat ? 1 : 0,
        r.dataPrevista,
        r.dataFi ?? null,
        r.categoriaId ?? null,
        r.referencia ?? null,
        r.origen,
        r.estat,
      );
    }
  });
}

// --- Manteniment ---

/**
 * Wipes every table and reseeds the default categories, leaving the database
 * as if freshly installed. Irreversible — the caller is responsible for
 * confirming with the user before invoking this (see the frontend's
 * Maintenance view).
 */
export function reinicialitzaBaseDades(): void {
  backupDbFile();
  const db = getDb();
  transaction(db, () => {
    db.exec(
      'DELETE FROM recurrents; DELETE FROM transferencies_descartades; DELETE FROM moviments; DELETE FROM lots; DELETE FROM regles; DELETE FROM categories; DELETE FROM comptes;',
    );
    const insert = db.prepare('INSERT INTO categories (id, nom) VALUES (?, ?)');
    for (const nom of DEFAULT_CATEGORIES) insert.run(randomUUID(), nom);
  });
}

/**
 * Wipes only the movements and their import batches, keeping comptes,
 * categories and regles untouched (unlike reinicialitzaBaseDades). Lots are
 * cleared alongside moviments — a lot's only purpose is undoing its own
 * movements, so keeping empty/orphaned lot records around after their
 * movements are gone would just be stale clutter in the import history.
 */
export function eliminaTotsElsMoviments(): void {
  backupDbFile();
  const db = getDb();
  transaction(db, () => {
    db.exec('DELETE FROM transferencies_descartades; DELETE FROM moviments; DELETE FROM lots;');
  });
}
