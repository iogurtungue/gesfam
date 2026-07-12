import type { PeriodicitatDetectable, PeriodicitatRecurrent } from '../api/types';

export const PERIODICITAT_LABEL: Record<PeriodicitatRecurrent, string> = {
  unica: 'Puntual',
  setmanal: 'Setmanal',
  mensual: 'Mensual',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
};

/** Ordre estable per als desplegables — de més freqüent a menys freqüent, amb 'unica' al final. */
export const PERIODICITATS_REPETITIVES: PeriodicitatDetectable[] = ['setmanal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'];
export const TOTES_LES_PERIODICITATS: PeriodicitatRecurrent[] = [...PERIODICITATS_REPETITIVES, 'unica'];
