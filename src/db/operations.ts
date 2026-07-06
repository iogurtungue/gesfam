import { db } from './schema';
import type { Compte, LotImportacio } from './types';
import { splitNousIDuplicats } from '../dedup';
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

export interface CommitImportResult {
  lot: LotImportacio;
  nous: number;
  duplicats: number;
}

/**
 * Inserts the new (non-duplicate) movements for one parsed account/file into
 * a single import batch (LotImportacio), so the whole import can be undone
 * atomically later (spec 3.1: "desfer un lot sencer").
 */
export async function commitImport(
  compte: Compte,
  moviments: ParsedMoviment[],
  fitxerOrigen: string,
): Promise<CommitImportResult> {
  const existingIds = new Set((await db.moviments.where({ compteId: compte.id }).primaryKeys()) as string[]);
  const { nous, duplicats } = splitNousIDuplicats(compte.banc, compte.id, moviments, existingIds);

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
      nous.map((m) => ({
        id: m.id,
        compteId: compte.id,
        dataOperacio: m.dataOperacio,
        dataValor: m.dataValor,
        concepteOriginal: m.concepteOriginal,
        concepteNormalitzat: m.concepteOriginal.toUpperCase().replace(/\s+/g, ' ').trim(),
        importCents: m.importCents,
        saldoPosteriorCents: m.saldoPosteriorCents,
        lotImportacioId: lot.id,
      })),
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
