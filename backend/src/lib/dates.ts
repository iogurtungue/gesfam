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

/** Data real d'avui en ISO (getters locals, mai `toISOString()` — mateix criteri que `isoFromDateCell`: evita el desplaçament d'un dia en fusos per davant d'UTC). */
export function isoAvui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Afegeix `dies` dies a una data ISO. */
export function afegeixDies(iso: string, dies: number): string {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dies);
  return data.toISOString().slice(0, 10);
}

/** Afegeix `mesos` mesos de calendari a una data ISO, preservant el dia del mes i clampant-lo a l'últim dia del mes objectiu si aquest no existeix (p. ex. 31/01 + 1 mes -> 28 o 29/02). */
export function afegeixMesos(iso: string, mesos: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const totalMesos = y * 12 + (m - 1) + mesos;
  const anyObjectiu = Math.floor(totalMesos / 12);
  const mesObjectiu = ((totalMesos % 12) + 12) % 12;
  const ultimDiaMesObjectiu = new Date(Date.UTC(anyObjectiu, mesObjectiu + 1, 0)).getUTCDate();
  const diaClampat = Math.min(d, ultimDiaMesObjectiu);
  return `${anyObjectiu}-${pad2(mesObjectiu + 1)}-${pad2(diaClampat)}`;
}

/** Nombre de dies entre dues dates ISO (b - a). */
export function diesEntre(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return (db - da) / 86_400_000;
}
