/**
 * Minimal, stable normalization used for the deduplication hash (spec 3.3).
 * The richer fuzzy normalization needed for recurrence grouping (stripping
 * variable reference numbers, spec 4.1.1) lives separately in
 * normalizeConceptForRecurrence, below — reusing it here would break dedup
 * stability (a movement's id must stay tied to its exact original concept).
 */
export function normalizeConceptForDedup(raw: string): string {
  return raw
    .normalize('NFC')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy normalization for recurrence grouping (spec 4.1.1, sub-fase 3.3): on
 * top of the stable dedup normalization, also strips digit runs of 4+
 * characters — long enough to be a reference/receipt number that varies
 * between otherwise-identical occurrences of the same recurring charge (e.g.
 * "RECIBO ENDESA REF 0012345" and "RECIBO ENDESA REF 0012399" must group
 * together), short enough to leave meaningful short numbers in a concept
 * intact (e.g. a plan name). Never reused for deduplication itself —
 * collapsing distinct reference numbers together would break a movement's
 * per-movement hash uniqueness.
 */
export function normalizeConceptForRecurrence(raw: string): string {
  return normalizeConceptForDedup(raw)
    .replace(/\d{4,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
