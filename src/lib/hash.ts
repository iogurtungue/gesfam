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
 * after each differs — a documented residual limitation of the spec, most
 * visible on card movements which often lack a balance column.
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
