/**
 * Groups digits with a dot every 3 digits from the right (Spanish
 * convention). Deliberately not `Number.toLocaleString('es-ES')`: whether
 * that actually inserts separators depends on the JS engine's ICU data being
 * complete for that locale — Node builds with "small-icu" silently return
 * ungrouped digits for any locale but en-US. This has no such dependency.
 */
function agrupaMilers(enter: number): string {
  return enter.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function centsToEs(cents: number, ambSimbol = true): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const centPart = (abs % 100).toString().padStart(2, '0');
  const euroText = agrupaMilers(euros);
  return `${negative ? '-' : ''}${euroText},${centPart}${ambSimbol ? ' €' : ''}`;
}
