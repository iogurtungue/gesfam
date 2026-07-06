export interface TransferCandidat {
  id: string;
  compteId: string;
  dataOperacio: string;
  importCents: number;
}

export interface SuggerimentTransferencia {
  a: string;
  b: string;
}

function diferenciaDies(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(db - da) / 86_400_000;
}

/**
 * Heuristic suggestion of internal transfers between the user's own accounts
 * (spec 3.4: "detectar (o permetre marcar)"). Pairs movements of equal
 * absolute amount, opposite sign, different accounts, within a few days of
 * each other. Deliberately a suggestion the user confirms — not applied
 * silently — since amount-only matching can produce false positives (e.g. two
 * unrelated payments of the same round amount).
 */
export function suggereixTransferenciesInternes(
  moviments: TransferCandidat[],
  maxDiesDiferencia = 2,
): SuggerimentTransferencia[] {
  const perImportAbsolut = new Map<number, TransferCandidat[]>();
  for (const m of moviments) {
    const abs = Math.abs(m.importCents);
    if (abs === 0) continue;
    const group = perImportAbsolut.get(abs) ?? [];
    group.push(m);
    perImportAbsolut.set(abs, group);
  }

  const suggeriments: SuggerimentTransferencia[] = [];
  const usats = new Set<string>();

  for (const grup of perImportAbsolut.values()) {
    if (grup.length < 2) continue;
    const ordenat = [...grup].sort((x, y) => x.dataOperacio.localeCompare(y.dataOperacio));
    for (let i = 0; i < ordenat.length; i++) {
      const a = ordenat[i];
      if (usats.has(a.id)) continue;
      for (let j = i + 1; j < ordenat.length; j++) {
        const b = ordenat[j];
        if (usats.has(b.id)) continue;
        if (diferenciaDies(a.dataOperacio, b.dataOperacio) > maxDiesDiferencia) break;
        if (b.compteId === a.compteId) continue;
        if (Math.sign(a.importCents) === Math.sign(b.importCents)) continue;
        suggeriments.push({ a: a.id, b: b.id });
        usats.add(a.id);
        usats.add(b.id);
        break;
      }
    }
  }

  return suggeriments;
}
