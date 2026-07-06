import { extractMovimentsFromTable, findLabeledValue, locateColumns, type ColumnDef } from '../tableUtils';
import type { ParseResult, RawTable } from '../types';

const ACCOUNT_COLUMNS: ColumnDef[] = [
  { key: 'fecha', patterns: ['F. VALOR', 'FECHA VALOR', 'FECHA'] },
  { key: 'descripcio', patterns: ['DESCRIPCIÓN', 'DESCRIPCION'] },
  { key: 'importe', patterns: ['IMPORTE'] },
  { key: 'saldo', patterns: ['SALDO'] },
];

const CARD_COLUMNS: ColumnDef[] = [
  { key: 'fecha', patterns: ['FECHA VALOR', 'F. VALOR', 'FECHA'] },
  { key: 'descripcio', patterns: ['DESCRIPCIÓN', 'DESCRIPCION'] },
  { key: 'estado', patterns: ['ESTADO'] },
  { key: 'importe', patterns: ['IMPORTE'] },
];

export function locateIngAccount(table: RawTable) {
  return locateColumns(table, ACCOUNT_COLUMNS);
}

export function locateIngCard(table: RawTable) {
  return locateColumns(table, CARD_COLUMNS);
}

export function parseIngAccount(table: RawTable): ParseResult {
  const located = locateIngAccount(table);
  if (!located) {
    throw new Error('No s\'ha trobat la capçalera esperada d\'un compte ING (F. Valor / Descripción / Importe / Saldo).');
  }
  const { moviments, warnings } = extractMovimentsFromTable(table, located, {
    dateKey: 'fecha',
    concepteKeys: ['descripcio'],
    importKey: 'importe',
    saldoKey: 'saldo',
  });
  return {
    compte: { banc: 'ing', tipus: 'corrent', numeroCompte: findLabeledValue(table, ['NÚMERO DE CUENTA']) },
    moviments,
    warnings,
  };
}

export function parseIngCard(table: RawTable): ParseResult {
  const located = locateIngCard(table);
  if (!located) {
    throw new Error('No s\'ha trobat la capçalera esperada d\'una targeta ING (Fecha Valor / Descripción / Estado / Importe).');
  }
  const { moviments, warnings } = extractMovimentsFromTable(table, located, {
    dateKey: 'fecha',
    concepteKeys: ['descripcio'],
    importKey: 'importe',
  });
  return {
    compte: { banc: 'ing', tipus: 'targeta', numeroCompte: findLabeledValue(table, ['NÚMERO DE TARJETA']) },
    moviments,
    warnings,
  };
}
