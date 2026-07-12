import type { PeriodicitatRecurrent, Recurrent } from '../api/types';

// Compartit entre RecurrentsList.tsx (pestanya Recurrents) i Previsio.tsx
// (edició d'un recurrent des de la seva ocurrència projectada) perquè
// totes dues facin servir exactament el mateix esborrany d'edició.

export interface EsborranyEdicio {
  concepte: string;
  periodicitat: PeriodicitatRecurrent;
  importEuros: string;
  importAproximat: boolean;
  dataPrevista: string;
  dataFi: string;
  categoriaId: string;
  referencia: string;
}

export function esborranyDe(r: Recurrent): EsborranyEdicio {
  return {
    concepte: r.concepte,
    periodicitat: r.periodicitat,
    importEuros: (r.importCents / 100).toString(),
    importAproximat: r.importAproximat,
    dataPrevista: r.dataPrevista,
    dataFi: r.dataFi ?? '',
    categoriaId: r.categoriaId ?? '',
    referencia: r.referencia ?? '',
  };
}

/** Converteix l'esborrany al payload d'`actualitzaRecurrent`, o `null` si l'import no és un número vàlid. */
export function esborranyAPayload(esborrany: EsborranyEdicio) {
  const importCents = Math.round(parseFloat(esborrany.importEuros.replace(',', '.')) * 100);
  if (Number.isNaN(importCents)) return null;
  return {
    concepte: esborrany.concepte,
    periodicitat: esborrany.periodicitat,
    importCents,
    importAproximat: esborrany.importAproximat,
    dataPrevista: esborrany.dataPrevista,
    dataFi: esborrany.dataFi || null,
    categoriaId: esborrany.categoriaId || null,
    referencia: esborrany.referencia || null,
  };
}
