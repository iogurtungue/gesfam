import { decodeBuffer } from '../lib/encoding.ts';
import { detectTableBank } from './detectBank.ts';
import { readExcelToRawTable } from './excelTable.ts';
import { detectFileKind } from './fileKind.ts';
import { readHtmlToRawTable } from './htmlTable.ts';
import { parseNorma43 } from './norma43.ts';
import type { ParseResult, RawTable } from './types.ts';

export type ImportOutcome =
  | { status: 'parsed'; results: ParseResult[] }
  | { status: 'needsMapping'; table: RawTable }
  | { status: 'error'; message: string };

export interface UploadedFile {
  name: string;
  buffer: ArrayBuffer;
}

/**
 * Reads a table-shaped file (Excel or HTML-table-as-.xls) into a RawTable,
 * without attempting bank detection. Shared by the automatic-detection path
 * below and the manual-column-mapping route, which needs the same raw table
 * again once the user has picked column indices — re-reading it from the
 * re-uploaded file keeps the backend stateless between requests.
 */
export function readRawTable(file: UploadedFile): RawTable {
  const kind = detectFileKind(file.buffer);
  if (kind === 'excel') return readExcelToRawTable(file.buffer);
  if (kind === 'html') return readHtmlToRawTable(decodeBuffer(file.buffer));
  throw new Error(`"${file.name}" no és un fitxer de taula (Excel/HTML) vàlid per a mapatge manual.`);
}

/**
 * Top-level entry point for the import wizard (spec 3.1): sniffs the file's
 * real format, routes to the matching parser, and either returns parsed
 * movements ready for preview, a raw table for manual column mapping when
 * automatic detection fails, or an error.
 *
 * Takes a plain `{ name, buffer }` rather than a DOM File — this runs on the
 * backend now, fed from a multipart upload (see routes.ts), not a browser
 * file input.
 */
export async function importFile(file: UploadedFile): Promise<ImportOutcome> {
  const buffer = file.buffer;
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
