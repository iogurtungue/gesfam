import { extractMovimentsFromTable, findLabeledValue, locateColumns, type ColumnDef } from '../tableUtils';
import type { ParseResult, RawTable } from '../types';

const ACCOUNT_COLUMNS: ColumnDef[] = [
  { key: 'dataOperacio', patterns: ['FECHA OPERACIÓN', 'FECHA OPERACION'] },
  { key: 'dataValor', patterns: ['FECHA VALOR'] },
  { key: 'concepte', patterns: ['CONCEPTO'] },
  { key: 'importe', patterns: ['IMPORTE'] },
  { key: 'saldo', patterns: ['SALDO'] },
];

export function locateOpenbankAccount(table: RawTable) {
  return locateColumns(table, ACCOUNT_COLUMNS);
}

export function parseOpenbankAccount(table: RawTable): ParseResult {
  const located = locateOpenbankAccount(table);
  if (!located) {
    throw new Error(
      "No s'ha trobat la capçalera esperada d'un compte OpenBank (Fecha Operación / Fecha Valor / Concepto / Importe / Saldo).",
    );
  }
  const { moviments, warnings } = extractMovimentsFromTable(table, located, {
    dateKey: 'dataOperacio',
    dateValorKey: 'dataValor',
    concepteKeys: ['concepte'],
    importKey: 'importe',
    saldoKey: 'saldo',
  });
  return {
    compte: { banc: 'openbank', tipus: 'corrent', numeroCompte: findLabeledValue(table, ['NÚMERO DE CUENTA']) },
    moviments,
    warnings,
  };
}
