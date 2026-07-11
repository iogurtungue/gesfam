function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * SheetJS with cellDates:true decodes an Excel serial date (which has no
 * timezone of its own — it's just a day count) into a Date object anchored
 * to the *reading machine's local timezone*, not UTC: verified empirically by
 * round-tripping a date through `xlsx` on a Europe/Madrid process — the
 * calendar date survives via the local getters, not the UTC ones. Using the
 * UTC getters here shifted every date back by one day for any timezone ahead
 * of UTC (bug reported by the user: ING movements showing a day earlier than
 * the bank's own export). Since encoding and decoding both happen on the
 * same machine/process, using the local getters is correct regardless of
 * which timezone that machine is actually in.
 */
export function isoFromDateCell(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Parses a date cell that may already be a JS Date (real Excel date cells,
 * e.g. ING's binary .xls), an ISO string (BBVA's card export), or a
 * dd/mm/yyyy (or dd/mm/yy) string (Spanish convention, per spec section 2).
 */
export function parseFlexibleDate(raw: string | Date): string {
  if (raw instanceof Date) {
    return isoFromDateCell(raw);
  }

  const s = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const es = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (es) {
    const [, d, m, yRaw] = es;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  throw new Error(`Format de data no reconegut: "${raw}"`);
}

/** Norma 43 dates are AAMMDD with a 2-digit year; these are always recent bank statements. */
export function parseNorma43Date(aammdd: string): string {
  if (!/^\d{6}$/.test(aammdd)) {
    throw new Error(`Data Norma 43 no vàlida: "${aammdd}"`);
  }
  const yy = aammdd.slice(0, 2);
  const mm = aammdd.slice(2, 4);
  const dd = aammdd.slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}
