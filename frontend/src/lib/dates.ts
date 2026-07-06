function pad2(n: number): string {
  return n.toString().padStart(2, '0');
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
