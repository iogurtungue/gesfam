import { extractMovimentsFromTable, findLabeledValue, locateColumns, type ColumnDef } from '../tableUtils';
import type { ParseResult, RawTable } from '../types';

// BBVA's card export headers are in Catalan, unlike its Norma 43 account files.
const CARD_COLUMNS: ColumnDef[] = [
  { key: 'data', patterns: ["DATA D'OPERACIÓ", "DATA D'OPERACIO"] },
  { key: 'concepte', patterns: ['CONCEPTE'] },
  { key: 'import', patterns: ['IMPORT'] },
];

export function locateBbvaCard(table: RawTable) {
  return locateColumns(table, CARD_COLUMNS);
}

export function parseBbvaCard(table: RawTable): ParseResult {
  const located = locateBbvaCard(table);
  if (!located) {
    throw new Error("No s'ha trobat la capçalera esperada d'una targeta BBVA (Data d'operació / Concepte / Import).");
  }
  const { moviments, warnings } = extractMovimentsFromTable(table, located, {
    dateKey: 'data',
    concepteKeys: ['concepte'],
    importKey: 'import',
  });
  const numeroCompte =
    findLabeledValue(table, ['NÚMERO DE CONTRACTE']) ?? findLabeledValue(table, ['NÚMERO DE TARGETA']);

  return {
    compte: { banc: 'bbva', tipus: 'targeta', numeroCompte },
    moviments,
    warnings,
  };
}
