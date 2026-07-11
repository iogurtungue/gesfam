import { computeMovimentHash } from '../lib/hash';
import type { BankId, ParsedMoviment } from '../parsers/types';

export type MovimentAmbId = ParsedMoviment & { id: string };

export function computeMovimentId(banc: BankId, compteId: string, moviment: ParsedMoviment): string {
  return computeMovimentHash({
    banc,
    compteId,
    dataOperacio: moviment.dataOperacio,
    importCents: moviment.importCents,
    concepteOriginal: moviment.concepteOriginal,
    saldoPosteriorCents: moviment.saldoPosteriorCents,
  });
}

export interface DedupResult {
  nous: MovimentAmbId[];
  duplicats: number;
}

/**
 * Splits freshly parsed movements into "new" (to insert) and "duplicate"
 * (silently ignored) per spec 3.3, checking only against already-stored ids
 * from a *previous* import — never against ids seen earlier in this same
 * batch. Two genuinely identical movements in the same source file (same
 * date, amount and concept — common on card statements, which often lack a
 * balance column to tell them apart) are real, separate transactions, not a
 * duplicate: deduplication only exists to guard against re-importing an
 * overlapping statement, not against a bank listing two coincidentally
 * identical-looking charges on the same day.
 *
 * `computeMovimentId` alone can't tell such movements apart (same hash), and
 * `moviments.id` is a primary key, so inserting two rows with the same id
 * would fail outright. The 2nd, 3rd... occurrence of a repeated hash within
 * the batch gets a deterministic `-2`, `-3`... suffix (the 1st keeps the bare
 * hash, so already-imported data and simple cases are unaffected). Suffixing
 * by order of appearance means a full re-import of the same file reproduces
 * the exact same suffixed ids, so the *whole* group is still recognized as
 * already-imported on a genuine re-import, not just its first occurrence.
 */
export function splitNousIDuplicats(
  banc: BankId,
  compteId: string,
  moviments: ParsedMoviment[],
  existingIds: ReadonlySet<string>,
): DedupResult {
  const nous: MovimentAmbId[] = [];
  const ocurrenciesPerHash = new Map<string, number>();
  let duplicats = 0;

  for (const moviment of moviments) {
    const hash = computeMovimentId(banc, compteId, moviment);
    const ocurrencia = (ocurrenciesPerHash.get(hash) ?? 0) + 1;
    ocurrenciesPerHash.set(hash, ocurrencia);
    const id = ocurrencia === 1 ? hash : `${hash}-${ocurrencia}`;

    if (existingIds.has(id)) {
      duplicats++;
      continue;
    }
    nous.push({ ...moviment, id });
  }

  return { nous, duplicats };
}
