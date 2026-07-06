import { describe, expect, it } from 'vitest';
import { parseNorma43 } from './norma43';

// Fabricated data built to the AEB/CECA "Cuaderno 43" (Junio 2012) fixed-width
// layout — offsets validated against real bank exports by cross-checking
// reconstructed running balances and debit/credit totals against the file's
// own footer records. Values here are invented, not real account data.

function numField(cents: number, length: number): string {
  return Math.abs(cents).toString().padStart(length, '0');
}

function textField(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, ' ');
}

function buildHeader(opts: {
  entitat: string;
  oficina: string;
  cuenta: string;
  dataInicial: string; // AAMMDD
  dataFinal: string; // AAMMDD
  signeSaldoInicial: '1' | '2';
  saldoInicialCents: number;
  nom: string;
}): string {
  return (
    '11' +
    opts.entitat.padStart(4, '0') +
    opts.oficina.padStart(4, '0') +
    opts.cuenta.padStart(10, '0') +
    opts.dataInicial +
    opts.dataFinal +
    opts.signeSaldoInicial +
    numField(opts.saldoInicialCents, 14) +
    '978' + // clau divisa EUR
    '1' + // modalitat
    textField(opts.nom, 26) +
    '   '
  );
}

function buildMoviment(opts: {
  dataOp: string;
  dataVal: string;
  concepteComu: string;
  concepteProps: string;
  signe: '1' | '2';
  importCents: number;
  ref1?: string;
  ref2?: string;
}): string {
  return (
    '22' +
    '    ' + // libre
    '0000' + // oficina origen
    opts.dataOp +
    opts.dataVal +
    opts.concepteComu +
    opts.concepteProps.padStart(3, '0') +
    opts.signe +
    numField(opts.importCents, 14) +
    '0000000000' + // num document
    textField(opts.ref1 ?? '', 12) +
    textField(opts.ref2 ?? '', 16)
  );
}

function buildComplementari(dato: string, concept1: string, concept2: string): string {
  return '23' + dato.padStart(2, '0') + textField(concept1, 38) + textField(concept2, 38);
}

function buildFooter(opts: {
  entitat: string;
  oficina: string;
  cuenta: string;
  napD: number;
  totD: number;
  napH: number;
  totH: number;
  signeFinal: '1' | '2';
  saldoFinalCents: number;
}): string {
  return (
    '33' +
    opts.entitat.padStart(4, '0') +
    opts.oficina.padStart(4, '0') +
    opts.cuenta.padStart(10, '0') +
    opts.napD.toString().padStart(5, '0') +
    numField(opts.totD, 14) +
    opts.napH.toString().padStart(5, '0') +
    numField(opts.totH, 14) +
    opts.signeFinal +
    numField(opts.saldoFinalCents, 14) +
    '978' +
    '    '
  );
}

describe('parseNorma43', () => {
  it('parses a single account with a registro23 concept, a ref1/ref2 fallback concept, and a code-based fallback', () => {
    const lines = [
      buildHeader({
        entitat: '81',
        oficina: '1234',
        cuenta: '123456',
        dataInicial: '260601',
        dataFinal: '260630',
        signeSaldoInicial: '2',
        saldoInicialCents: 100000, // 1000,00
        nom: 'CLIENT DE PROVA',
      }),
      buildMoviment({
        dataOp: '260605',
        dataVal: '260605',
        concepteComu: '03',
        concepteProps: '1',
        signe: '1',
        importCents: 2500, // -25,00
      }),
      // Word split across the 38-char boundary, mid-word — regression test
      // for the concat-then-collapse fix (must NOT become "NOMIN ALIA").
      buildComplementari('01', 'REBUT PROVEIDOR DEMO ENERGIA XXI SLU-N', 'UM FACTURA JUNY'),
      buildMoviment({
        dataOp: '260610',
        dataVal: '260610',
        concepteComu: '04',
        concepteProps: '2',
        signe: '2',
        importCents: 5000, // +50,00
        // ref1 fills all 12 chars with no padding, so it must concatenate
        // directly with ref2 (mirrors BBVA's real "CÀRREC MENSU"+"AL DE
        // TARGETA" export, which has no space at the field boundary).
        ref1: 'TRANSFERENCI',
        ref2: 'A REBUDA TEST',
      }),
      buildMoviment({
        dataOp: '260615',
        dataVal: '260615',
        concepteComu: '12',
        concepteProps: '3',
        signe: '1',
        importCents: 1000, // -10,00, no ref text and no registro23
      }),
      buildFooter({
        entitat: '81',
        oficina: '1234',
        cuenta: '123456',
        napD: 2,
        totD: 3500,
        napH: 1,
        totH: 5000,
        signeFinal: '2',
        saldoFinalCents: 101500, // 100000 - 2500 + 5000 - 1000
      }),
    ];

    const [result] = parseNorma43(lines.join('\r\n'));

    expect(result.compte.banc).toBe('sabadell');
    expect(result.compte.numeroCompte).toBe('0000123456');
    expect(result.compte.saldoConegutCents).toBe(101500);
    expect(result.warnings).toEqual([]);
    expect(result.moviments).toHaveLength(3);

    expect(result.moviments[0].concepteOriginal).toBe('REBUT PROVEIDOR DEMO ENERGIA XXI SLU-NUM FACTURA JUNY');
    expect(result.moviments[0].importCents).toBe(-2500);
    expect(result.moviments[0].saldoPosteriorCents).toBe(97500);

    expect(result.moviments[1].concepteOriginal).toBe('TRANSFERENCIA REBUDA TEST');
    expect(result.moviments[1].importCents).toBe(5000);
    expect(result.moviments[1].saldoPosteriorCents).toBe(102500);

    // No registro23 and a blank ref1/ref2: falls back to the common-concept code label.
    expect(result.moviments[2].concepteOriginal).toBe('Targetes de crèdit - Targetes dèbit');
    expect(result.moviments[2].importCents).toBe(-1000);
    expect(result.moviments[2].saldoPosteriorCents).toBe(101500);
  });

  it('warns when the reconstructed running balance disagrees with the footer', () => {
    const lines = [
      buildHeader({
        entitat: '81',
        oficina: '1234',
        cuenta: '999999',
        dataInicial: '260601',
        dataFinal: '260602',
        signeSaldoInicial: '2',
        saldoInicialCents: 1000,
        nom: 'CLIENT DIVERGENT',
      }),
      buildMoviment({
        dataOp: '260602',
        dataVal: '260602',
        concepteComu: '99',
        concepteProps: '1',
        signe: '1',
        importCents: 500,
      }),
      buildFooter({
        entitat: '81',
        oficina: '1234',
        cuenta: '999999',
        napD: 1,
        totD: 500,
        napH: 0,
        totH: 0,
        signeFinal: '2',
        saldoFinalCents: 9999, // deliberately wrong vs. 1000 - 500 = 500
      }),
    ];

    const [result] = parseNorma43(lines.join('\r\n'));
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/no coincideix/);
  });

  it('parses multiple accounts sequentially within a single file', () => {
    const account1 = [
      buildHeader({
        entitat: '81',
        oficina: '0001',
        cuenta: '111111',
        dataInicial: '260601',
        dataFinal: '260601',
        signeSaldoInicial: '2',
        saldoInicialCents: 5000,
        nom: 'COMPTE U',
      }),
      buildMoviment({ dataOp: '260601', dataVal: '260601', concepteComu: '02', concepteProps: '1', signe: '2', importCents: 1000 }),
      buildFooter({
        entitat: '81',
        oficina: '0001',
        cuenta: '111111',
        napD: 0,
        totD: 0,
        napH: 1,
        totH: 1000,
        signeFinal: '2',
        saldoFinalCents: 6000,
      }),
    ];
    const account2 = [
      buildHeader({
        entitat: '182',
        oficina: '0002',
        cuenta: '222222',
        dataInicial: '260601',
        dataFinal: '260601',
        signeSaldoInicial: '2',
        saldoInicialCents: 7000,
        nom: 'COMPTE DOS',
      }),
      buildMoviment({ dataOp: '260601', dataVal: '260601', concepteComu: '01', concepteProps: '1', signe: '1', importCents: 200 }),
      buildFooter({
        entitat: '182',
        oficina: '0002',
        cuenta: '222222',
        napD: 1,
        totD: 200,
        napH: 0,
        totH: 0,
        signeFinal: '2',
        saldoFinalCents: 6800,
      }),
    ];

    const results = parseNorma43([...account1, ...account2].join('\r\n'));
    expect(results).toHaveLength(2);
    expect(results[0].compte.banc).toBe('sabadell');
    expect(results[0].compte.numeroCompte).toBe('0000111111');
    expect(results[1].compte.banc).toBe('bbva');
    expect(results[1].compte.numeroCompte).toBe('0000222222');
  });
});
