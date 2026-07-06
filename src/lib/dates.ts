function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** SheetJS with cellDates:true builds Date objects at UTC midnight of the calendar date. */
export function isoFromUTCDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Parses a date cell that may already be a JS Date (real Excel date cells,
 * e.g. ING's binary .xls), an ISO string (BBVA's card export), or a
 * dd/mm/yyyy (or dd/mm/yy) string (Spanish convention, per spec section 2).
 */
export function parseFlexibleDate(raw: string | Date): string {
  if (raw instanceof Date) {
    return isoFromUTCDate(raw);
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

/**
 * Today's date in the user's local timezone, as an ISO yyyy-mm-dd string.
 * Deliberately NOT `new Date().toISOString().slice(0, 10)`: toISOString is
 * always UTC, and Spain's timezone is ahead of UTC (CET/CEST) — during the
 * early-morning hours that expression silently returns *yesterday's* date,
 * which excluded today's just-imported movements from balance calculations
 * that use "up to today" as their cutoff.
 */
export function avui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Displays an ISO yyyy-mm-dd date in Spanish convention dd/mm/aaaa (spec section 2). */
export function formatDateEs(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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
