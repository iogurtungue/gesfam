import { parseNorma43Date } from '../lib/dates';
import type { BankId, ParseResult, ParsedAccountInfo, ParsedMoviment } from './types';

// AEB/CECA "Cuaderno 43" Anexo 2 — common interbank concept codes.
const COMMON_CONCEPTS: Record<string, string> = {
  '01': 'Talons - Reintegraments',
  '02': 'Abonarés - Entregues - Ingressos',
  '03': 'Domiciliats - Rebuts - Lletres - Pagaments per compte',
  '04': 'Girs - Transferències - Traspassos - Xecs',
  '05': 'Amortitzacions préstecs, crèdits, etc.',
  '06': 'Remeses efectes',
  '07': 'Subscripcions - Div. passius - Bescanvis',
  '08': 'Div. cupons - Prima junta - Amortitzacions',
  '09': 'Operacions de borsa i/o compra/venda valors',
  '10': 'Xecs gasolina',
  '11': 'Caixer automàtic',
  '12': 'Targetes de crèdit - Targetes dèbit',
  '13': 'Operacions estranger',
  '14': 'Devolucions i impagats',
  '15': 'Nòmines - Assegurances socials',
  '16': 'Timbres - Corretatge - Pòlissa',
  '17': 'Interessos - Comissions - Custòdia - Despeses i impostos',
  '98': 'Anul·lacions - Correccions assentament',
  '99': 'Varis',
};

const ENTITAT_TO_BANK: Record<string, BankId> = {
  '0081': 'sabadell',
  '0182': 'bbva',
};

function bankFromEntitat(entitat: string): BankId {
  return ENTITAT_TO_BANK[entitat] ?? 'altre';
}

function signedCents(digits: string, signChar: string): number {
  const abs = parseInt(digits, 10);
  return signChar === '1' ? -abs : abs;
}

interface InProgressAccount {
  info: ParsedAccountInfo;
  dataFinalPeriode: string;
  saldoInicialCents: number;
  moviments: ParsedMoviment[];
  pendingMoviment: ParsedMoviment | null;
  pendingConceptParts: string[];
  warnings: string[];
}

function flushPendingMoviment(acc: InProgressAccount): void {
  if (!acc.pendingMoviment) return;
  // Concept sub-fields are a raw split of one continuous string (each 38
  // chars), not word-wrapped — concatenate directly, then collapse
  // whitespace once at the end, or a mid-word split becomes "NOMIN ALIA".
  const extra = acc.pendingConceptParts.join('').replace(/\s+/g, ' ').trim();
  if (extra) {
    acc.pendingMoviment.concepteOriginal = extra;
  }
  acc.moviments.push(acc.pendingMoviment);
  acc.pendingMoviment = null;
  acc.pendingConceptParts = [];
}

function finalizeAccount(acc: InProgressAccount, saldoFinalCents: number): ParseResult {
  let running = acc.saldoInicialCents;
  for (const mov of acc.moviments) {
    running += mov.importCents;
    mov.saldoPosteriorCents = running;
  }
  if (running !== saldoFinalCents) {
    acc.warnings.push(
      `El saldo final calculat (${running}) no coincideix amb el saldo final del registre 33 ` +
        `(${saldoFinalCents}) per al compte ${acc.info.numeroCompte}. Es manté igualment la reconstrucció moviment a moviment.`,
    );
  }
  acc.info.saldoConegutCents = saldoFinalCents;
  acc.info.dataSaldoConegut = acc.dataFinalPeriode;
  return { compte: acc.info, moviments: acc.moviments, warnings: acc.warnings };
}

/**
 * Parses a Norma 43 / AEB43 / CSB43 fixed-width bank statement file (used by
 * Sabadell and BBVA current-account exports). Field offsets are taken from
 * the official AEB/CECA "Cuaderno 43" spec (Junio 2012) and cross-validated
 * against real sample files: reconstructed running balances and debit/credit
 * totals matched the file's own registro 33 footer exactly.
 *
 * A single file can contain several accounts back to back (11...22...23...33
 * repeated); each yields its own ParseResult.
 */
export function parseNorma43(text: string): ParseResult[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const results: ParseResult[] = [];
  let acc: InProgressAccount | null = null;

  for (const line of lines) {
    const cod = line.slice(0, 2);

    if (cod === '11') {
      const entitat = line.slice(2, 6);
      const oficina = line.slice(6, 10);
      const numeroCompte = line.slice(10, 20);
      const dataInicial = parseNorma43Date(line.slice(20, 26));
      const dataFinal = parseNorma43Date(line.slice(26, 32));
      const saldoInicialCents = signedCents(line.slice(33, 47), line.slice(32, 33));

      acc = {
        info: {
          banc: bankFromEntitat(entitat),
          tipus: 'corrent',
          entitat,
          oficina,
          numeroCompte,
          saldoConegutCents: saldoInicialCents,
          dataSaldoConegut: dataInicial,
        },
        dataFinalPeriode: dataFinal,
        saldoInicialCents,
        moviments: [],
        pendingMoviment: null,
        pendingConceptParts: [],
        warnings: [],
      };
      continue;
    }

    if (!acc) {
      // Stray record before any account header; nothing sensible to attach it to.
      continue;
    }

    if (cod === '22') {
      flushPendingMoviment(acc);
      const dataOperacio = parseNorma43Date(line.slice(10, 16));
      const dataValor = parseNorma43Date(line.slice(16, 22));
      const concepteComu = line.slice(22, 24);
      const signe = line.slice(27, 28);
      const importCents = signedCents(line.slice(28, 42), signe);
      const ref1 = line.slice(52, 64);
      const ref2 = line.slice(64, 80);
      const fallbackText = (ref1 + ref2).trim();
      const hasLetters = /[A-Za-zÀ-ÿ]/.test(fallbackText);
      const concepteOriginal = hasLetters
        ? fallbackText.replace(/\s+/g, ' ').trim()
        : (COMMON_CONCEPTS[concepteComu] ?? 'Moviment');

      acc.pendingMoviment = {
        dataOperacio,
        dataValor,
        concepteOriginal,
        importCents,
        saldoPosteriorCents: null,
      };
      acc.pendingConceptParts = [];
    } else if (cod === '23') {
      if (acc.pendingMoviment) {
        // Raw (untrimmed) 38-char sub-fields: concatenated directly in
        // flushPendingMoviment so a word split across the boundary rejoins.
        acc.pendingConceptParts.push(line.slice(4, 42), line.slice(42, 80));
      }
    } else if (cod === '24') {
      // Foreign-currency equivalence record; not used.
    } else if (cod === '33') {
      flushPendingMoviment(acc);
      const saldoFinalCents = signedCents(line.slice(59, 73), line.slice(58, 59));
      results.push(finalizeAccount(acc, saldoFinalCents));
      acc = null;
    }
    // '88' (end of file) and anything else: ignored.
  }

  return results;
}
