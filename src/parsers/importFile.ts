import { decodeBuffer } from '../lib/encoding';
import { detectTableBank } from './detectBank';
import { readExcelToRawTable } from './excelTable';
import { detectFileKind } from './fileKind';
import { readHtmlToRawTable } from './htmlTable';
import { parseNorma43 } from './norma43';
import type { ParseResult, RawTable } from './types';

export type ImportOutcome =
  | { status: 'parsed'; results: ParseResult[] }
  | { status: 'needsMapping'; table: RawTable }
  | { status: 'error'; message: string };

/**
 * Top-level entry point for the import wizard (spec 3.1): sniffs the file's
 * real format, routes to the matching parser, and either returns parsed
 * movements ready for preview, a raw table for manual column mapping when
 * automatic detection fails, or an error.
 */
export async function importFile(file: File): Promise<ImportOutcome> {
  const buffer = await file.arrayBuffer();
  const kind = detectFileKind(buffer);

  try {
    switch (kind) {
      case 'norma43': {
        const text = decodeBuffer(buffer);
        const results = parseNorma43(text);
        if (results.length === 0) {
          return { status: 'error', message: `No s'ha pogut interpretar cap compte del fitxer Norma 43 "${file.name}".` };
        }
        return { status: 'parsed', results };
      }
      case 'excel': {
        const table = readExcelToRawTable(buffer);
        const detection = detectTableBank(table);
        if (!detection) return { status: 'needsMapping', table };
        return { status: 'parsed', results: [detection.parse(table)] };
      }
      case 'html': {
        const text = decodeBuffer(buffer);
        const table = readHtmlToRawTable(text);
        const detection = detectTableBank(table);
        if (!detection) return { status: 'needsMapping', table };
        return { status: 'parsed', results: [detection.parse(table)] };
      }
      default:
        return { status: 'error', message: `Format de fitxer no reconegut per a "${file.name}".` };
    }
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}
