import type { ReglaLiquidacioDirecta } from '../db/types.ts';

/**
 * Detecta, pel concepte normalitzat d'un moviment de targeta, si es tracta
 * d'una retirada/disposició d'efectiu (especificacio.md 3.2.1) — mateixa
 * lògica de substring que pickCategoriaId/pickTargetaLiquidacio, però
 * retornant un booleà: aquí no cal triar entre diverses regles, només saber
 * si alguna hi coincideix.
 */
export function esRetiradaEfectiu(concepteNormalitzat: string, regles: ReglaLiquidacioDirecta[]): boolean {
  return regles.some((r) => r.patro.trim() !== '' && concepteNormalitzat.includes(r.patro.toUpperCase()));
}

export interface CandidatAparellamentDirecte {
  id: string;
  dataOperacio: string;
  importCents: number;
}

export interface SuggerimentAparellamentDirecte {
  targetaMovimentId: string;
  correntMovimentId: string;
}

function diferenciaDies(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const dbb = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(dbb - da) / 86_400_000;
}

/**
 * Suggereix aparellar cada moviment de targeta marcat com a liquidació
 * directa (p. ex. una retirada d'efectiu en caixer) amb el càrrec del
 * compte corrent que la va cobrar directament (especificacio.md 3.2.1). A
 * diferència de suggereixTransferenciesInternes, aquí es busca el **mateix**
 * import (no el signe oposat): tots dos extractes registren la mateixa
 * despesa real, no és un moviment de diners entre dos comptes propis.
 */
export function suggereixAparellamentsLiquidacioDirecta(
  targetaMoviments: CandidatAparellamentDirecte[],
  correntMoviments: CandidatAparellamentDirecte[],
  maxDiesDiferencia = 2,
): SuggerimentAparellamentDirecte[] {
  const usats = new Set<string>();
  const suggeriments: SuggerimentAparellamentDirecte[] = [];
  const ordenats = [...correntMoviments].sort((a, b) => a.dataOperacio.localeCompare(b.dataOperacio));

  for (const t of [...targetaMoviments].sort((a, b) => a.dataOperacio.localeCompare(b.dataOperacio))) {
    let millor: CandidatAparellamentDirecte | undefined;
    let millorDiferencia = Infinity;
    for (const c of ordenats) {
      if (usats.has(c.id)) continue;
      if (c.importCents !== t.importCents) continue;
      const dies = diferenciaDies(t.dataOperacio, c.dataOperacio);
      if (dies > maxDiesDiferencia) continue;
      if (dies < millorDiferencia) {
        millor = c;
        millorDiferencia = dies;
      }
    }
    if (millor) {
      suggeriments.push({ targetaMovimentId: t.id, correntMovimentId: millor.id });
      usats.add(millor.id);
    }
  }

  return suggeriments;
}
