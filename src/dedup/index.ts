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
 * (silently ignored) per spec 3.3, checking both against already-stored ids
 * and against ids seen earlier in the same batch. The latter guards the
 * documented residual limitation: two genuinely identical same-day
 * movements (same amount, concept, and running balance) are indistinguishable
 * and the second will be dropped as a duplicate.
 */
export function splitNousIDuplicats(
  banc: BankId,
  compteId: string,
  moviments: ParsedMoviment[],
  existingIds: ReadonlySet<string>,
): DedupResult {
  const nous: MovimentAmbId[] = [];
  const seenInBatch = new Set<string>();
  let duplicats = 0;

  for (const moviment of moviments) {
    const id = computeMovimentId(banc, compteId, moviment);
    if (existingIds.has(id) || seenInBatch.has(id)) {
      duplicats++;
      continue;
    }
    seenInBatch.add(id);
    nous.push({ ...moviment, id });
  }

  return { nous, duplicats };
}
