/**
 * Parses a bank-exported amount into signed integer cents.
 *
 * Handles two real-world cases seen across bank exports:
 * - Genuine numeric Excel cells (e.g. ING's binary .xls): passed through as
 *   a JS number already, just scaled to cents.
 * - Text amounts, which vary in convention even within Spanish banks: comma
 *   decimals with dot thousands ("1.234,56"), plain comma decimals
 *   ("-763,44"), or plain dot decimals ("20.27"). Norma 43 amounts never hit
 *   this path — they're fixed-width integer-cent fields parsed directly.
 */
export function parseAmountToCents(raw: string | number): number {
  if (typeof raw === 'number') {
    return Math.round(raw * 100);
  }

  let s = raw.trim().replace(/[€\s ]/g, '');
  if (s === '') {
    throw new Error('Import buit');
  }

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let integerPart: string;
  let decimalPart: string;

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      integerPart = s.slice(0, lastComma).replace(/\./g, '');
      decimalPart = s.slice(lastComma + 1);
    } else {
      integerPart = s.slice(0, lastDot).replace(/,/g, '');
      decimalPart = s.slice(lastDot + 1);
    }
  } else if (lastComma !== -1) {
    integerPart = s.slice(0, lastComma);
    decimalPart = s.slice(lastComma + 1);
  } else if (lastDot !== -1) {
    const after = s.slice(lastDot + 1);
    if (after.length === 3) {
      // Three digits after the only dot: thousands separator, no decimals
      // ("1.234" -> 1234), matching Spanish convention for whole amounts.
      integerPart = s.replace(/\./g, '');
      decimalPart = '';
    } else {
      integerPart = s.slice(0, lastDot);
      decimalPart = after;
    }
  } else {
    integerPart = s;
    decimalPart = '';
  }

  decimalPart = (decimalPart + '00').slice(0, 2);
  const digits = (integerPart || '0').replace(/[^0-9]/g, '');
  if (digits === '' && decimalPart === '00') {
    throw new Error(`Format d'import no reconegut: "${raw}"`);
  }

  const cents = parseInt(digits || '0', 10) * 100 + parseInt(decimalPart, 10);
  return negative ? -cents : cents;
}

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
