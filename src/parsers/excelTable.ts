import * as XLSX from 'xlsx';
import type { RawRow, RawTable } from './types';

/**
 * Reads a real Excel file (OOXML .xlsx or legacy binary .xls) into a plain
 * RawTable. cellDates:true so genuinely date-formatted numeric cells (as in
 * ING's exports) come through as JS Date objects instead of Excel serials;
 * raw:true so numeric amount cells keep their true float value instead of a
 * locale-formatted display string (SheetJS sometimes formats numeric cells
 * with US-style grouping regardless of the workbook's origin locale).
 */
export function readExcelToRawTable(buffer: ArrayBuffer): RawTable {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { header: 1, raw: true, defval: '' });
}
