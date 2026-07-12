import { parseFlexibleDate } from '../lib/dates';
import { parseAmountToCents } from '../lib/numbers';
import { cellToText, locateColumns, type ColumnDef, type LocatedColumns } from './tableUtils';
import type { RawTable } from './types';

const COLUMNS: ColumnDef[] = [
  { key: 'dataVenciment', patterns: ['DATA DE VENCIMENT', 'DATA VENCIMENT'] },
  { key: 'concepte', patterns: ['CONCEPTE'] },
  { key: 'import', patterns: ['IMPORT'] },
  { key: 'categoria', patterns: ['CATEGORIA'], required: false },
  { key: 'referencia', patterns: ['REFERÈNCIA', 'REFERENCIA'], required: false },
];

/** Una fila del fitxer de compromisos confirmats (especificacio.md 4.2): sempre un venciment puntual (periodicitat 'unica'), mai un patró recurrent. */
export interface ParsedRecurrentImport {
  concepte: string;
  importCents: number;
  dataPrevista: string;
  /** Nom de categoria tal com apareix al fitxer, encara sense resoldre a un id (spec 4.2: "si el nom coincideix amb una categoria existent, s'assigna automàticament"). */
  categoriaNom?: string;
  referencia?: string;
}

export interface ParseRecurrentsFileResult {
  recurrents: ParsedRecurrentImport[];
  warnings: string[];
}

export function locateRecurrentsColumns(table: RawTable): LocatedColumns | null {
  return locateColumns(table, COLUMNS);
}

/**
 * Parses the fixed-column Excel format for confirmed commitments
 * (especificacio.md 4.2): Data de venciment / Concepte / Import obligatoris,
 * Categoria / Referència opcionals. Header-based, tolerant a un preàmbul de
 * files per sobre de la capçalera, com la resta de parsers (spec 3.2).
 */
export function parseRecurrentsFile(table: RawTable): ParseRecurrentsFileResult {
  const located = locateRecurrentsColumns(table);
  if (!located) {
    throw new Error("No s'ha trobat la capçalera esperada (Data de venciment / Concepte / Import).");
  }

  const recurrents: ParsedRecurrentImport[] = [];
  const warnings: string[] = [];

  for (let i = located.headerRowIndex + 1; i < table.length; i++) {
    const row = table[i];
    if (row.every((cell) => cellToText(cell) === '')) continue;

    try {
      const dataPrevista = parseFlexibleDate(row[located.columns.dataVenciment] as string | Date);
      const concepte = cellToText(row[located.columns.concepte]);
      if (concepte === '') throw new Error('Concepte buit');
      const importCents = parseAmountToCents(row[located.columns.import] as string | number);
      const categoriaNom =
        located.columns.categoria !== undefined ? cellToText(row[located.columns.categoria]) || undefined : undefined;
      const referencia =
        located.columns.referencia !== undefined ? cellToText(row[located.columns.referencia]) || undefined : undefined;

      recurrents.push({ concepte, importCents, dataPrevista, categoriaNom, referencia });
    } catch (err) {
      warnings.push(`Fila ${i + 1} no interpretable: ${(err as Error).message}`);
    }
  }

  return { recurrents, warnings };
}
