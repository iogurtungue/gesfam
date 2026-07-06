export interface MovimentPerResum {
  dataOperacio: string;
  importCents: number;
  categoriaId?: string;
  esTransferenciaInterna?: boolean;
}

export const SENSE_CATEGORIA = '__sense_categoria__';

export interface TotalsPerCategoria {
  ingressosCents: number;
  despesesCents: number;
}

export interface ResumPeriode {
  periode: string;
  ingressosCents: number;
  despesesCents: number;
  perCategoria: Record<string, TotalsPerCategoria>;
}

function buit(): TotalsPerCategoria {
  return { ingressosCents: 0, despesesCents: 0 };
}

function acumula(resum: ResumPeriode, m: MovimentPerResum): void {
  const categoriaKey = m.categoriaId ?? SENSE_CATEGORIA;
  if (!resum.perCategoria[categoriaKey]) {
    resum.perCategoria[categoriaKey] = buit();
  }
  if (m.importCents >= 0) {
    resum.ingressosCents += m.importCents;
    resum.perCategoria[categoriaKey].ingressosCents += m.importCents;
  } else {
    resum.despesesCents += -m.importCents;
    resum.perCategoria[categoriaKey].despesesCents += -m.importCents;
  }
}

/**
 * Groups movements into ingressos/despeses-per-categoria totals (spec 3.5
 * "resum mensual", generalized to also cover annual and custom-interval
 * summaries). Internal transfers are excluded — spec 3.4: they must not
 * count as real income/expense in aggregates. despesesCents is always a
 * positive magnitude (the sum of the absolute value of charges).
 */
function resumPerClau(moviments: MovimentPerResum[], clau: (m: MovimentPerResum) => string): ResumPeriode[] {
  const perClau = new Map<string, ResumPeriode>();

  for (const m of moviments) {
    if (m.esTransferenciaInterna) continue;
    const key = clau(m);
    let resum = perClau.get(key);
    if (!resum) {
      resum = { periode: key, ingressosCents: 0, despesesCents: 0, perCategoria: {} };
      perClau.set(key, resum);
    }
    acumula(resum, m);
  }

  return [...perClau.values()].sort((a, b) => a.periode.localeCompare(b.periode));
}

/** One block per calendar month ('YYYY-MM'). */
export function resumPerMesICategoria(moviments: MovimentPerResum[]): ResumPeriode[] {
  return resumPerClau(moviments, (m) => m.dataOperacio.slice(0, 7));
}

/** One block per calendar year ('YYYY'). */
export function resumPerAnyICategoria(moviments: MovimentPerResum[]): ResumPeriode[] {
  return resumPerClau(moviments, (m) => m.dataOperacio.slice(0, 4));
}

/**
 * A single summary block for an arbitrary date range (spec 3.5 "resum...per
 * interval de data"). Either bound may be omitted for an open-ended range.
 */
export function resumInterval(moviments: MovimentPerResum[], dataDes?: string, dataFins?: string): ResumPeriode {
  const resum: ResumPeriode = { periode: 'interval', ingressosCents: 0, despesesCents: 0, perCategoria: {} };
  for (const m of moviments) {
    if (m.esTransferenciaInterna) continue;
    if (dataDes && m.dataOperacio < dataDes) continue;
    if (dataFins && m.dataOperacio > dataFins) continue;
    acumula(resum, m);
  }
  return resum;
}
