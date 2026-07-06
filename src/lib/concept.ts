/**
 * Minimal, stable normalization used for the deduplication hash (spec 3.3).
 * The richer fuzzy normalization needed for recurrence grouping (stripping
 * variable reference numbers, spec 4.1.1) is a separate concern for a later
 * phase and would break dedup stability if reused here.
 */
export function normalizeConceptForDedup(raw: string): string {
  return raw
    .normalize('NFC')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
