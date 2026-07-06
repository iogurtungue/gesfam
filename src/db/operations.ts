import { db, DEFAULT_CATEGORIES } from './schema';
import type { Categoria, Compte, LotImportacio, Moviment, ReglaCategoritzacio } from './types';
import { splitNousIDuplicats } from '../dedup';
import { pickCategoriaId } from '../lib/categorization';
import { normalizeConceptForDedup } from '../lib/concept';
import { saldoEnData } from '../lib/balance';
import { suggereixTransferenciesInternes, type SuggerimentTransferencia } from '../lib/internalTransfers';
import type { AccountType, BankId, ParsedMoviment } from '../parsers/types';

export function listComptes(): Promise<Compte[]> {
  return db.comptes.toArray();
}

export function listLots(): Promise<LotImportacio[]> {
  return db.lots.toArray();
}

export async function createCompte(data: {
  banc: BankId;
  tipus: AccountType;
  alias: string;
  numeroCompte?: string;
}): Promise<Compte> {
  const compte: Compte = {
    id: crypto.randomUUID(),
    banc: data.banc,
    tipus: data.tipus,
    alias: data.alias,
    ibanOUltimsDigits: data.numeroCompte,
  };
  await db.comptes.add(compte);
  return compte;
}

export async function findMatchingCompte(
  banc: BankId,
  tipus: AccountType,
  numeroCompte?: string,
): Promise<Compte | undefined> {
  if (!numeroCompte) return undefined;
  const comptes = await db.comptes.where({ banc, tipus }).toArray();
  return comptes.find((c) => c.ibanOUltimsDigits === numeroCompte);
}

export async function renombraCompte(compteId: string, alias: string): Promise<void> {
  await db.comptes.update(compteId, { alias });
}

export function countMovimentsCompte(compteId: string): Promise<number> {
  return db.moviments.where({ compteId }).count();
}

/**
 * Deletes an account only if it has no associated movements — a deletion
 * that silently dropped movements would be a much bigger, less reversible
 * surprise than being told to remove them first (via the "eliminar només els
 * moviments" maintenance action, or per-account if that's ever added).
 * Also drops the account's own import batches, which would otherwise be
 * orphaned references to a compteId that no longer exists.
 */
export async function eliminaCompte(compteId: string): Promise<void> {
  await db.transaction('rw', db.comptes, db.moviments, db.lots, async () => {
    const teMoviments = (await db.moviments.where({ compteId }).count()) > 0;
    if (teMoviments) {
      throw new Error('No es pot eliminar un compte que té moviments associats.');
    }
    await db.lots.where({ compteId }).delete();
    await db.comptes.delete(compteId);
  });
}

export interface CommitImportResult {
  lot: LotImportacio;
  nous: number;
  duplicats: number;
}

/**
 * Inserts the new (non-duplicate) movements for one parsed account/file into
 * a single import batch (LotImportacio), so the whole import can be undone
 * atomically later (spec 3.1: "desfer un lot sencer"). New movements are
 * auto-categorized against the user's rules (spec 3.4) as they're inserted.
 */
export async function commitImport(
  compte: Compte,
  moviments: ParsedMoviment[],
  fitxerOrigen: string,
): Promise<CommitImportResult> {
  const existingIds = new Set((await db.moviments.where({ compteId: compte.id }).primaryKeys()) as string[]);
  const { nous, duplicats } = splitNousIDuplicats(compte.banc, compte.id, moviments, existingIds);
  const regles = await db.regles.toArray();
  const darrer = await db.moviments.orderBy('seq').last();
  let seguent = (darrer?.seq ?? -1) + 1;

  const lot: LotImportacio = {
    id: crypto.randomUUID(),
    data: new Date().toISOString(),
    fitxerOrigen,
    banc: compte.banc,
    compteId: compte.id,
    nombreMoviments: nous.length,
  };

  await db.transaction('rw', db.moviments, db.lots, async () => {
    await db.moviments.bulkAdd(
      // `nous` preserves the parser's original file order, so assigning
      // strictly increasing `seq` here is what lets same-day movements sort
      // back into file order later, since IndexedDB doesn't preserve
      // insertion order on its own.
      nous.map((m) => {
        const concepteNormalitzat = normalizeConceptForDedup(m.concepteOriginal);
        return {
          id: m.id,
          compteId: compte.id,
          dataOperacio: m.dataOperacio,
          dataValor: m.dataValor,
          concepteOriginal: m.concepteOriginal,
          concepteNormalitzat,
          importCents: m.importCents,
          saldoPosteriorCents: m.saldoPosteriorCents,
          lotImportacioId: lot.id,
          seq: seguent++,
          categoriaId: pickCategoriaId(concepteNormalitzat, regles),
        };
      }),
    );
    await db.lots.add(lot);
  });

  return { lot, nous: nous.length, duplicats };
}

/** Removes every movement from a batch and the batch record itself (spec 3.1: undo a whole import). */
export async function undoLot(lotId: string): Promise<void> {
  await db.transaction('rw', db.moviments, db.lots, async () => {
    await db.moviments.where({ lotImportacioId: lotId }).delete();
    await db.lots.delete(lotId);
  });
}

export function listMovimentsPerComptes(compteIds: string[]): Promise<Moviment[]> {
  if (compteIds.length === 0) return Promise.resolve([]);
  return db.moviments.where('compteId').anyOf(compteIds).toArray();
}

export function listAllMoviments(): Promise<Moviment[]> {
  return db.moviments.toArray();
}

// --- Categories i regles de categorització (spec 3.4) ---

export async function listCategories(): Promise<Categoria[]> {
  const categories = await db.categories.toArray();
  // No `.localeCompare(nom, 'ca')` here on purpose: an explicit locale
  // argument depends on the JS engine having full ICU data for it, which
  // isn't guaranteed (see centsToEs's history) — the no-arg form already
  // sorts accented Catalan names correctly and has no such dependency.
  return categories.sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function createCategoria(nom: string): Promise<Categoria> {
  const categoria: Categoria = { id: crypto.randomUUID(), nom };
  await db.categories.add(categoria);
  return categoria;
}

export async function renombraCategoria(categoriaId: string, nom: string): Promise<void> {
  await db.categories.update(categoriaId, { nom });
}

export async function deleteCategoria(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.regles, db.moviments, async () => {
    await db.categories.delete(id);
    await db.regles.where({ categoriaId: id }).delete();
    const afectats = await db.moviments.where({ categoriaId: id }).primaryKeys();
    await db.moviments.bulkUpdate(afectats.map((key) => ({ key, changes: { categoriaId: undefined } })));
  });
}

export function listRegles(): Promise<ReglaCategoritzacio[]> {
  return db.regles.toArray();
}

export async function createRegla(data: { patro: string; categoriaId: string; prioritat: number }): Promise<ReglaCategoritzacio> {
  const regla: ReglaCategoritzacio = { id: crypto.randomUUID(), ...data };
  await db.regles.add(regla);
  return regla;
}

export async function deleteRegla(id: string): Promise<void> {
  await db.regles.delete(id);
}

export async function setMovimentCategoria(movimentId: string, categoriaId: string | undefined): Promise<void> {
  await db.moviments.update(movimentId, { categoriaId });
}

/** Applies the current rules only to movements that don't have a category yet, so manual overrides are never clobbered. */
export async function aplicaReglesAMovimentsSenseCategoria(): Promise<number> {
  const regles = await db.regles.toArray();
  if (regles.length === 0) return 0;
  const sensecat = await db.moviments.filter((m) => !m.categoriaId).toArray();
  const canvis = sensecat
    .map((m) => ({ key: m.id, categoriaId: pickCategoriaId(m.concepteNormalitzat, regles) }))
    .filter((c) => c.categoriaId !== undefined);
  if (canvis.length === 0) return 0;
  await db.moviments.bulkUpdate(canvis.map((c) => ({ key: c.key, changes: { categoriaId: c.categoriaId } })));
  return canvis.length;
}

// --- Transferències internes (spec 3.4) ---

export async function setTransferenciaInterna(movimentId: string, value: boolean): Promise<void> {
  await db.moviments.update(movimentId, { esTransferenciaInterna: value });
}

export interface SuggerimentAmbDetall extends SuggerimentTransferencia {
  movimentA: Moviment;
  movimentB: Moviment;
}

/** Suggests candidate internal-transfer pairs across all accounts, for the user to confirm (spec 3.4). */
export async function suggereixTransferencies(): Promise<SuggerimentAmbDetall[]> {
  const moviments = (await db.moviments.toArray()).filter((m) => !m.esTransferenciaInterna);
  const perId = new Map(moviments.map((m) => [m.id, m]));
  const suggeriments = suggereixTransferenciesInternes(
    moviments.map((m) => ({ id: m.id, compteId: m.compteId, dataOperacio: m.dataOperacio, importCents: m.importCents })),
  );
  return suggeriments.map((s) => ({ ...s, movimentA: perId.get(s.a)!, movimentB: perId.get(s.b)! }));
}

export async function confirmaTransferencia(suggeriment: SuggerimentTransferencia): Promise<void> {
  await db.transaction('rw', db.moviments, async () => {
    await db.moviments.update(suggeriment.a, { esTransferenciaInterna: true });
    await db.moviments.update(suggeriment.b, { esTransferenciaInterna: true });
  });
}

// --- Saldo a una data (spec 3.5) ---

export async function saldoEnDataCompte(compte: Compte, dataISO: string): Promise<number | null> {
  const moviments = await db.moviments.where({ compteId: compte.id }).toArray();
  return saldoEnData(moviments, compte.tipus, dataISO);
}

/** Current balance: latest known running balance for corrent, accumulated debt for targeta. */
export async function saldoActualCompte(compte: Compte): Promise<number | null> {
  return saldoEnDataCompte(compte, '9999-12-31');
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

export async function exportaCopiaSeguretat(): Promise<Backup> {
  const [comptes, moviments, lots, categories, regles] = await Promise.all([
    db.comptes.toArray(),
    db.moviments.toArray(),
    db.lots.toArray(),
    db.categories.toArray(),
    db.regles.toArray(),
  ]);
  return { versio: 1, exportatEl: new Date().toISOString(), comptes, moviments, lots, categories, regles };
}

/** Replaces all local data with the backup's contents. Destructive by design — the whole point is restoring a clean copy. */
export async function importaCopiaSeguretat(backup: Backup): Promise<void> {
  await db.transaction('rw', db.comptes, db.moviments, db.lots, db.categories, db.regles, async () => {
    await Promise.all([
      db.comptes.clear(),
      db.moviments.clear(),
      db.lots.clear(),
      db.categories.clear(),
      db.regles.clear(),
    ]);
    await Promise.all([
      db.comptes.bulkAdd(backup.comptes),
      db.moviments.bulkAdd(backup.moviments),
      db.lots.bulkAdd(backup.lots),
      db.categories.bulkAdd(backup.categories),
      db.regles.bulkAdd(backup.regles),
    ]);
  });
}

// --- Manteniment ---

/**
 * Wipes every table and reseeds the default categories, leaving the database
 * as if freshly installed. Irreversible — the caller is responsible for
 * confirming with the user before invoking this (see views/Maintenance.tsx).
 */
export async function reinicialitzaBaseDades(): Promise<void> {
  await db.transaction('rw', db.comptes, db.moviments, db.lots, db.categories, db.regles, async () => {
    await Promise.all([
      db.comptes.clear(),
      db.moviments.clear(),
      db.lots.clear(),
      db.categories.clear(),
      db.regles.clear(),
    ]);
    await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((nom) => ({ id: crypto.randomUUID(), nom })));
  });
}

/**
 * Wipes only the movements and their import batches, keeping comptes,
 * categories and regles untouched (unlike reinicialitzaBaseDades). Lots are
 * cleared alongside moviments — a lot's only purpose is undoing its own
 * movements, so keeping empty/orphaned lot records around after their
 * movements are gone would just be stale clutter in the import history.
 * Existing accounts can be re-imported into immediately afterwards; dedup
 * won't see any prior movements and will treat everything as new.
 */
export async function eliminaTotsElsMoviments(): Promise<void> {
  await db.transaction('rw', db.moviments, db.lots, async () => {
    await Promise.all([db.moviments.clear(), db.lots.clear()]);
  });
}
