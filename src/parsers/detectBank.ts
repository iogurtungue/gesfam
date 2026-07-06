import { locateBbvaCard, parseBbvaCard } from './banks/bbva';
import { locateIngAccount, locateIngCard, parseIngAccount, parseIngCard } from './banks/ing';
import { locateOpenbankAccount, parseOpenbankAccount } from './banks/openbank';
import type { ParseResult, RawTable } from './types';

export interface TableBankDetection {
  label: string;
  parse: (table: RawTable) => ParseResult;
}

/**
 * Tries each known table-based bank/account-type header signature in turn.
 * Each candidate's `locate` check is mutually exclusive by construction (they
 * key on columns unique to that export), so order doesn't affect the result
 * — but bank-specific formats are tried before giving up and asking the user
 * for a manual column mapping (spec 3.1.4).
 */
export function detectTableBank(table: RawTable): TableBankDetection | null {
  if (locateBbvaCard(table)) return { label: 'BBVA (targeta)', parse: parseBbvaCard };
  if (locateIngCard(table)) return { label: 'ING (targeta)', parse: parseIngCard };
  if (locateIngAccount(table)) return { label: 'ING (compte corrent)', parse: parseIngAccount };
  if (locateOpenbankAccount(table)) return { label: 'OpenBank (compte corrent)', parse: parseOpenbankAccount };
  return null;
}
