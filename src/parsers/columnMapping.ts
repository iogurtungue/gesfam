import { extractMovimentsFromTable, type ExtractMovimentsResult, type LocatedColumns } from './tableUtils';
import type { AccountType, BankId, RawTable } from './types';

/**
 * A manual column mapping, used when automatic bank/format detection fails
 * (spec 3.1.4). Serializable so it can be persisted per bank as a reusable
 * template — the user only maps columns once per source format.
 */
export interface ColumnMapping {
  banc: BankId;
  tipus: AccountType;
  headerRowIndex: number;
  dataOperacioCol: number;
  dataValorCol?: number;
  concepteCols: number[];
  importCol: number;
  saldoCol?: number;
}

export function applyColumnMapping(table: RawTable, mapping: ColumnMapping): ExtractMovimentsResult {
  const columns: Record<string, number> = {
    data: mapping.dataOperacioCol,
    importe: mapping.importCol,
  };
  const concepteKeys: string[] = [];
  mapping.concepteCols.forEach((col, i) => {
    const key = `concepte${i}`;
    columns[key] = col;
    concepteKeys.push(key);
  });
  if (mapping.dataValorCol !== undefined) columns.dataValor = mapping.dataValorCol;
  if (mapping.saldoCol !== undefined) columns.saldo = mapping.saldoCol;

  const located: LocatedColumns = { headerRowIndex: mapping.headerRowIndex, columns };

  return extractMovimentsFromTable(table, located, {
    dateKey: 'data',
    dateValorKey: mapping.dataValorCol !== undefined ? 'dataValor' : undefined,
    concepteKeys,
    importKey: 'importe',
    saldoKey: mapping.saldoCol !== undefined ? 'saldo' : undefined,
  });
}
