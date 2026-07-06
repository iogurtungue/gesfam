import type { RawTable } from './types';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|\w+);/g, (match, code: string) => {
    if (code[0] === '#') {
      const codePoint = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

function cellText(fragment: string): string {
  const withoutTags = fragment.replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/**
 * Some bank exports (OpenBank) save an HTML table with a ".xls" extension.
 * The markup is often malformed (e.g. <font> wrapping <td> instead of the
 * reverse), so this deliberately avoids a full DOM/HTML parser and just pulls
 * <tr>...</tr> blocks and, within each, well-formed <td>...</td>/<th>...</th>
 * pairs in source order. Self-closing decorative <td/> spacer cells (common
 * in these exports) don't match and are skipped, which is fine since they're
 * skipped consistently on every row.
 */
export function readHtmlToRawTable(html: string): RawTable {
  const rows: RawTable = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells: string[] = [];
    tdRegex.lastIndex = 0;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(cellText(tdMatch[1]));
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}
