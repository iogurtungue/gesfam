import { normalizeConceptForDedup } from './concept';

/**
 * cyrb53 — a small, fast, well-distributed non-cryptographic string hash.
 * Public domain (https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js).
 * Used only for deduplication identity, not security.
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(36);
}

export interface MovimentHashInput {
  banc: string;
  compteId: string;
  dataOperacio: string;
  importCents: number;
  concepteOriginal: string;
  saldoPosteriorCents: number | null;
}

/**
 * Deterministic id per spec 3.3: hash of (banc, compte, data operació, import,
 * concepte normalitzat, saldo posterior). Two legitimately identical same-day
 * movements (same amount + concept) collide here unless the running balance
 * after each differs — most visible on card movements, which often lack a
 * balance column. This is fine: the collision only needs to be resolved for
 * movements imported in the same batch (see splitNousIDuplicats's per-batch
 * occurrence suffix), since re-import protection across separate imports
 * only needs *a* stable id per movement, not a unique one on its own.
 */
export function computeMovimentHash(input: MovimentHashInput): string {
  const key = [
    input.banc,
    input.compteId,
    input.dataOperacio,
    input.importCents,
    normalizeConceptForDedup(input.concepteOriginal),
    input.saldoPosteriorCents ?? 'null',
  ].join('|');
  return cyrb53(key);
}

/**
 * Deterministic id for the synthetic counterpart movement created on a
 * card's account when a checking-account movement is marked as that card's
 * monthly settlement (especificacio.md 3.2.1). Same input, same id — so
 * re-marking after a reimport (which reassigns the same movement hash to
 * the settlement charge, per computeMovimentHash) reproduces the exact same
 * counterpart instead of creating a duplicate. A distinct seed keeps this
 * id-space separate from computeMovimentHash's (seed 0), even though the
 * key material itself already differs (a fixed prefix, not movement fields).
 */
export function computeContrapartidaId(movimentOrigenId: string): string {
  return cyrb53(`contrapartida-liquidacio-targeta:${movimentOrigenId}`, 1);
}
