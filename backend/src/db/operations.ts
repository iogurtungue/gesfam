import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { backupDbFile } from './backupFile.ts';
import { getDb } from './client.ts';
import type { Categoria, Compte, LotImportacio, Moviment, ReglaCategoritzacio } from './types.ts';
import { splitNousIDuplicats } from '../dedup/index.ts';
import { pickCategoriaId } from '../lib/categorization.ts';
import { normalizeConceptForDedup } from '../lib/concept.ts';
import { suggereixTransferenciesInternes, type SuggerimentTransferencia } from '../lib/internalTransfers.ts';
import type { AccountType, BankId, ParsedMoviment } from '../parsers/types.ts';

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
  const darrerSeq = db.prepare('SELECT MAX(seq) AS maxSeq FROM moviments').get() as { maxSeq: number | null };
  let seguent = (darrerSeq.maxSeq ?? -1) + 1;

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

export interface SuggerimentAmbDetall extends SuggerimentTransferencia {
  movimentA: Moviment;
  movimentB: Moviment;
}

/** Suggests candidate internal-transfer pairs across all accounts, for the user to confirm (spec 3.4). */
export function suggereixTransferencies(): SuggerimentAmbDetall[] {
  const moviments = listAllMoviments().filter((m) => !m.esTransferenciaInterna);
  const perId = new Map(moviments.map((m) => [m.id, m]));
  const suggeriments = suggereixTransferenciesInternes(
    moviments.map((m) => ({ id: m.id, compteId: m.compteId, dataOperacio: m.dataOperacio, importCents: m.importCents })),
  );
  return suggeriments.map((s) => ({ ...s, movimentA: perId.get(s.a)!, movimentB: perId.get(s.b)! }));
}

export function confirmaTransferencia(suggeriment: SuggerimentTransferencia): void {
  const db = getDb();
  transaction(db, () => {
    db.prepare('UPDATE moviments SET es_transferencia_interna = 1 WHERE id = ?').run(suggeriment.a);
    db.prepare('UPDATE moviments SET es_transferencia_interna = 1 WHERE id = ?').run(suggeriment.b);
  });
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
  };
}

/** Replaces all local data with the backup's contents. Destructive by design — the whole point is restoring a clean copy. */
export function importaCopiaSeguretat(backup: Backup): void {
  backupDbFile();
  const db = getDb();
  transaction(db, () => {
    db.exec('DELETE FROM moviments; DELETE FROM lots; DELETE FROM regles; DELETE FROM categories; DELETE FROM comptes;');

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

    const insertLot = db.prepare('INSERT INTO lots (id, data, fitxer_origen, banc, compte_id, nombre_moviments) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of backup.lots) insertLot.run(l.id, l.data, l.fitxerOrigen, l.banc, l.compteId, l.nombreMoviments);

    const insertMoviment = db.prepare(
      `INSERT INTO moviments
        (id, compte_id, data_operacio, data_valor, concepte_original, concepte_normalitzat, import_cents, saldo_posterior_cents, categoria_id, lot_importacio_id, es_transferencia_interna, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    db.exec('DELETE FROM moviments; DELETE FROM lots; DELETE FROM regles; DELETE FROM categories; DELETE FROM comptes;');
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
    db.exec('DELETE FROM moviments; DELETE FROM lots;');
  });
}
