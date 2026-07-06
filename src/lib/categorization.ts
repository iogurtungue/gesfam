import type { ReglaCategoritzacio } from '../db/types';

/**
 * Applies the user's categorization rules (spec 3.4: "si el concepte conté
 * ENDESA → subministraments") to a normalized concept. Rules are tried in
 * ascending `prioritat` order; the first whose pattern is a case-insensitive
 * substring match wins. Returns undefined when no rule matches, leaving the
 * movement uncategorized rather than guessing.
 */
export function pickCategoriaId(concepteNormalitzat: string, regles: ReglaCategoritzacio[]): string | undefined {
  const sorted = [...regles].sort((a, b) => a.prioritat - b.prioritat);
  for (const regla of sorted) {
    if (regla.patro.trim() === '') continue;
    if (concepteNormalitzat.includes(regla.patro.toUpperCase())) {
      return regla.categoriaId;
    }
  }
  return undefined;
}
