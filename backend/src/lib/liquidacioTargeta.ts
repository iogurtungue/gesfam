import type { ReglaLiquidacioTargeta } from '../db/types.ts';

/**
 * Detecta, pel concepte normalitzat d'un càrrec del compte corrent, a quina
 * targeta correspon la seva liquidació mensual (especificacio.md 3.2.1).
 * Mateixa lògica de substring que pickCategoriaId, però sense prioritat: la
 * primera regla que hi coincideix guanya (un mateix concepte no hauria de
 * coincidir amb els patrons de dues targetes diferents).
 */
export function pickTargetaLiquidacio(concepteNormalitzat: string, regles: ReglaLiquidacioTargeta[]): string | undefined {
  for (const regla of regles) {
    if (regla.patro.trim() === '') continue;
    if (concepteNormalitzat.includes(regla.patro.toUpperCase())) {
      return regla.targetaCompteId;
    }
  }
  return undefined;
}
