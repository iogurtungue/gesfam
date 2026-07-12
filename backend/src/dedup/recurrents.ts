import { computeRecurrentHash } from '../lib/hash';
import type { ParsedRecurrentImport } from '../parsers/recurrentsFile';

export type RecurrentImportAmbId = ParsedRecurrentImport & { id: string };

export interface DedupRecurrentsResult {
  nous: RecurrentImportAmbId[];
  duplicats: number;
}

/**
 * Same policy as splitNousIDuplicats for bank movements (spec 3.3), applied
 * to compromisos importats: dedup only against ids already stored from a
 * *previous* import of this same compte, never within the batch being
 * imported right now — two coincidentally identical invoices in one file
 * (same due date/amount/concept) get a deterministic per-occurrence suffix
 * instead of being silently dropped, and reimporting the same file
 * reproduces the exact same suffixed ids.
 */
export function splitNousRecurrentsIDuplicats(
  compteId: string,
  recurrents: ParsedRecurrentImport[],
  existingIds: ReadonlySet<string>,
): DedupRecurrentsResult {
  const nous: RecurrentImportAmbId[] = [];
  const ocurrenciesPerHash = new Map<string, number>();
  let duplicats = 0;

  for (const r of recurrents) {
    const hash = computeRecurrentHash({ compteId, dataPrevista: r.dataPrevista, importCents: r.importCents, concepteOriginal: r.concepte });
    const ocurrencia = (ocurrenciesPerHash.get(hash) ?? 0) + 1;
    ocurrenciesPerHash.set(hash, ocurrencia);
    const id = ocurrencia === 1 ? hash : `${hash}-${ocurrencia}`;

    if (existingIds.has(id)) {
      duplicats++;
      continue;
    }
    nous.push({ ...r, id });
  }

  return { nous, duplicats };
}
