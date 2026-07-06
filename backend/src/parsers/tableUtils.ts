import { parseAmountToCents } from '../lib/numbers';
import { parseFlexibleDate } from '../lib/dates';
import type { ParsedMoviment, RawCell, RawRow, RawTable } from './types';

export function cellToText(cell: RawCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}

function normalizeHeaderText(cell: RawCell): string {
  return cellToText(cell)
    .toUpperCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlankRow(row: RawRow): boolean {
  return row.every((cell) => cellToText(cell) === '');
}

export interface ColumnDef {
  key: string;
  /** Matched against the header cell text, uppercased with parentheses stripped. */
  patterns: string[];
  /** Defaults to true: if not found, the whole row is rejected as a header candidate. */
  required?: boolean;
}

export interface LocatedColumns {
  headerRowIndex: number;
  columns: Record<string, number>;
}

/**
 * Scans a raw table for the row that looks like the real column header,
 * tolerating an arbitrary number of preamble/metadata rows above it (very
 * common in bank Excel/HTML exports — see spec 3.2). Matching is by header
 * text, never by fixed column position.
 */
export function locateColumns(table: RawTable, columnDefs: ColumnDef[]): LocatedColumns | null {
  for (let i = 0; i < table.length; i++) {
    const normalized = table[i].map(normalizeHeaderText);
    const columns: Record<string, number> = {};
    let ok = true;
    for (const def of columnDefs) {
      const idx = normalized.findIndex((text) => def.patterns.some((p) => text === p.toUpperCase()));
      if (idx === -1) {
        if (def.required === false) continue;
        ok = false;
        break;
      }
      columns[def.key] = idx;
    }
    if (ok) return { headerRowIndex: i, columns };
  }
  return null;
}

/**
 * Scans the whole table (including the metadata preamble above the movement
 * header, e.g. "Número de cuenta: 1234...") for a labeled value, returning
 * the first non-blank cell after a matching label in the same row. Bank
 * exports don't put an account/card number in the movement table itself, so
 * without this, re-imports in a fresh session can't auto-match the existing
 * account and every import would look "new" to the dedup step.
 */
export function findLabeledValue(table: RawTable, labelPatterns: string[]): string | undefined {
  const patterns = labelPatterns.map((p) => p.toUpperCase());
  for (const row of table) {
    for (let i = 0; i < row.length; i++) {
      const text = normalizeHeaderText(row[i]).replace(/:$/, '');
      if (patterns.some((p) => text === p)) {
        for (let j = i + 1; j < row.length; j++) {
          const value = cellToText(row[j]).trim();
          if (value !== '') return value.replace(/\s+/g, '');
        }
      }
    }
  }
  return undefined;
}

export interface ExtractMovimentsOptions {
  dateKey: string;
  dateValorKey?: string;
  concepteKeys: string[];
  importKey: string;
  saldoKey?: string;
}

export interface ExtractMovimentsResult {
  moviments: ParsedMoviment[];
  warnings: string[];
  rowsInterpretades: number;
  rowsNoInterpretables: number;
}

/**
 * Walks the rows below the header extracting one ParsedMoviment per row.
 * Blank rows are silently skipped (common as visual spacers); rows that fail
 * to parse are counted and warned about but don't abort the rest of the
 * import (spec 3.1.6: report unparseable rows for review, don't lose the
 * rest of the batch).
 */
export function extractMovimentsFromTable(
  table: RawTable,
  located: LocatedColumns,
  opts: ExtractMovimentsOptions,
): ExtractMovimentsResult {
  const moviments: ParsedMoviment[] = [];
  const warnings: string[] = [];
  let rowsNoInterpretables = 0;

  for (let i = located.headerRowIndex + 1; i < table.length; i++) {
    const row = table[i];
    if (isBlankRow(row)) continue;

    try {
      const dateCell = row[located.columns[opts.dateKey]];
      const dataOperacio = parseFlexibleDate(dateCell as string | Date);
      const dataValor = opts.dateValorKey
        ? parseFlexibleDate(row[located.columns[opts.dateValorKey]] as string | Date)
        : dataOperacio;

      const concepteOriginal = opts.concepteKeys
        .map((key) => cellToText(row[located.columns[key]]))
        .filter((text) => text !== '')
        .join(' - ');

      const importCents = parseAmountToCents(row[located.columns[opts.importKey]] as string | number);
      const saldoPosteriorCents = opts.saldoKey
        ? parseAmountToCents(row[located.columns[opts.saldoKey]] as string | number)
        : null;

      moviments.push({ dataOperacio, dataValor, concepteOriginal, importCents, saldoPosteriorCents });
    } catch (err) {
      rowsNoInterpretables++;
      warnings.push(`Fila ${i + 1} no interpretable: ${(err as Error).message}`);
    }
  }

  return { moviments, warnings, rowsInterpretades: moviments.length, rowsNoInterpretables };
}
