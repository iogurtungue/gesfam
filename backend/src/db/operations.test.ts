import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedRecurrentImport } from '../parsers/recurrentsFile.ts';
import type { ParsedMoviment } from '../parsers/types.ts';

process.env.GESFAM_DB_PATH = ':memory:';
const { getDb } = await import('./client.ts');
const {
  actualitzaCompte,
  actualitzaRecurrent,
  actualitzaRegla,
  commitImport,
  confirmaCandidatRecurrent,
  confirmaTransferencia,
  countMovimentsCompte,
  creaRecurrentManual,
  createCategoria,
  createCompte,
  createRegla,
  createReglaLiquidacio,
  descartaTransferencia,
  deleteReglaLiquidacio,
  desmarcaLiquidacioTargeta,
  detectaCandidatsRecurrents,
  eliminaCompte,
  eliminaMoviment,
  eliminaRecurrent,
  eliminaTotsElsMoviments,
  exportaCopiaSeguretat,
  ignoraCandidatRecurrent,
  importaCopiaSeguretat,
  importaRecurrents,
  listCategories,
  listComptes,
  listLots,
  listMovimentsPerComptes,
  listRecurrents,
  listReglesLiquidacio,
  listRegles,
  listTransferenciesDescartades,
  marcaLiquidacioTargeta,
  reinicialitzaBaseDades,
  renombraCategoria,
  setMovimentCategoria,
  setTransferenciaInterna,
  suggereixLiquidacionsTargeta,
  suggereixTransferencies,
  undoLot,
} = await import('./operations.ts');

beforeEach(() => {
  getDb().exec(
    'DELETE FROM recurrents; DELETE FROM transferencies_descartades; DELETE FROM moviments; DELETE FROM lots; DELETE FROM regles; DELETE FROM regles_liquidacio; DELETE FROM categories; DELETE FROM comptes;',
  );
});

function mov(dataOperacio: string, concepteOriginal: string, importCents: number): ParsedMoviment {
  return { dataOperacio, dataValor: dataOperacio, concepteOriginal, importCents, saldoPosteriorCents: null };
}

describe('commitImport', () => {
  it('assigns seq in file order so same-day movements can be told apart later (bug: llista no ordenada quan la data coincideix)', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    commitImport(
      compte,
      [mov('2026-06-05', 'Primer del dia', -100), mov('2026-06-05', 'Segon del dia', -200), mov('2026-06-05', 'Tercer del dia', -300)],
      'extracte.txt',
    );

    const moviments = listMovimentsPerComptes([compte.id]);
    const perOrdreDeSeq = [...moviments].sort((a, b) => a.seq - b.seq);
    expect(perOrdreDeSeq.map((m) => m.concepteOriginal)).toEqual(['Primer del dia', 'Segon del dia', 'Tercer del dia']);
  });

  it('keeps seq strictly increasing across separate import calls, never restarting', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    commitImport(compte, [mov('2026-06-01', 'Primera importació', -100)], 'lot1.txt');
    commitImport(compte, [mov('2026-06-02', 'Segona importació', -200)], 'lot2.txt');

    const moviments = listMovimentsPerComptes([compte.id]);
    const primera = moviments.find((m) => m.concepteOriginal === 'Primera importació')!;
    const segona = moviments.find((m) => m.concepteOriginal === 'Segona importació')!;
    expect(segona.seq).toBeGreaterThan(primera.seq);
  });

  it('auto-categorizes new movements against existing rules', () => {
    const categoria = createCategoria('Subministraments');
    createRegla({ patro: 'ENDESA', categoriaId: categoria.id, prioritat: 0 });
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });

    commitImport(compte, [mov('2026-06-01', 'RECIBO ENDESA ENERGIA', -50)], 'test.txt');

    const [moviment] = listMovimentsPerComptes([compte.id]);
    expect(moviment.categoriaId).toBe(categoria.id);
  });
});

describe('listCategories', () => {
  it('returns categories sorted alphabetically, not in insertion order', () => {
    createCategoria('Transport');
    createCategoria('Alimentació');
    createCategoria('Nòmina');

    const categories = listCategories();
    expect(categories.map((c) => c.nom)).toEqual(['Alimentació', 'Nòmina', 'Transport']);
  });
});

describe('createRegla', () => {
  it('refuses to create a rule pointing at a category that does not exist (regression: orphaned categoriaId left movements looking uncategorized)', () => {
    expect(() => createRegla({ patro: 'TEST', categoriaId: 'no-existeix', prioritat: 0 })).toThrow();
    expect(listRegles()).toEqual([]);
  });
});

describe('actualitzaRegla', () => {
  it('updates the patró and/or categoriaId of an existing rule', () => {
    const categoriaA = createCategoria('Categoria A');
    const categoriaB = createCategoria('Categoria B');
    const regla = createRegla({ patro: 'ENDESA', categoriaId: categoriaA.id, prioritat: 0 });

    actualitzaRegla(regla.id, { patro: 'IBERDROLA' });
    expect(listRegles()[0]).toMatchObject({ patro: 'IBERDROLA', categoriaId: categoriaA.id });

    actualitzaRegla(regla.id, { categoriaId: categoriaB.id });
    expect(listRegles()[0]).toMatchObject({ patro: 'IBERDROLA', categoriaId: categoriaB.id });
  });

  it('refuses to point a rule at a category that does not exist', () => {
    const categoria = createCategoria('Categoria');
    const regla = createRegla({ patro: 'ENDESA', categoriaId: categoria.id, prioritat: 0 });
    expect(() => actualitzaRegla(regla.id, { categoriaId: 'no-existeix' })).toThrow();
    expect(listRegles()[0].categoriaId).toBe(categoria.id);
  });
});

describe('setMovimentCategoria', () => {
  it('refuses to assign a category that does not exist', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    commitImport(compte, [mov('2026-01-01', 'Test', -100)], 'test.txt');
    const [moviment] = listMovimentsPerComptes([compte.id]);

    expect(() => setMovimentCategoria(moviment.id, 'no-existeix')).toThrow();
    expect(listMovimentsPerComptes([compte.id])[0].categoriaId).toBeUndefined();
  });
});

describe('renombraCategoria', () => {
  it('updates the category name', () => {
    const categoria = createCategoria('Nom antic');
    renombraCategoria(categoria.id, 'Nom nou');
    const [actualitzada] = listCategories();
    expect(actualitzada.nom).toBe('Nom nou');
    expect(actualitzada.id).toBe(categoria.id);
  });
});

describe('actualitzaCompte', () => {
  it('updates the alias without touching anything else', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Nom original' });
    actualitzaCompte(compte.id, { alias: 'Nom nou' });
    const [actualitzat] = listComptes();
    expect(actualitzat.alias).toBe('Nom nou');
    expect(actualitzat.id).toBe(compte.id);
    expect(actualitzat.banc).toBe('sabadell');
  });

  it('updates banc, tipus, ordre and grup together', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte' });
    actualitzaCompte(compte.id, { banc: 'bbva', tipus: 'targeta', ordre: 5, grup: 'Família' });
    const [actualitzat] = listComptes();
    expect(actualitzat.banc).toBe('bbva');
    expect(actualitzat.tipus).toBe('targeta');
    expect(actualitzat.ordre).toBe(5);
    expect(actualitzat.grup).toBe('Família');
  });

  it('refuses a compteLiquidacioId that does not point to an existing account', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    expect(() => actualitzaCompte(compte.id, { compteLiquidacioId: 'no-existeix' })).toThrow();
  });

  it('refuses a diaLiquidacio outside 1-31', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    expect(() => actualitzaCompte(compte.id, { diaLiquidacio: 32 })).toThrow();
  });
});

describe('listComptes', () => {
  it('orders accounts by ordre, then falls back to alias for accounts without one', () => {
    const b = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'B' });
    const a = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'A' });
    actualitzaCompte(a.id, { ordre: 1 });
    actualitzaCompte(b.id, { ordre: 0 });
    expect(listComptes().map((c) => c.alias)).toEqual(['B', 'A']);
  });
});

describe('eliminaCompte', () => {
  it('deletes an account with no movements, and its own (empty) import batches', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte buit' });
    // An import that results in zero new movements (e.g. everything was a
    // duplicate) still creates a lot — that lot must go with the account.
    commitImport(compte, [], 'buit.txt');
    expect(countMovimentsCompte(compte.id)).toBe(0);

    eliminaCompte(compte.id);

    expect(listComptes()).toEqual([]);
    expect(listLots().filter((l) => l.compteId === compte.id)).toHaveLength(0);
  });

  it('refuses to delete an account that has movements', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte amb moviments' });
    commitImport(compte, [mov('2026-01-01', 'Test', -100)], 'test.txt');

    expect(() => eliminaCompte(compte.id)).toThrow();

    expect(listComptes()).toHaveLength(1);
    expect(countMovimentsCompte(compte.id)).toBe(1);
  });
});

describe('eliminaTotsElsMoviments', () => {
  it('clears moviments and lots but keeps comptes, categories and regles intact', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    commitImport(compte, [mov('2026-01-01', 'Test', -100)], 'test.txt');
    const categoriaManual = createCategoria('Categoria manual');
    createRegla({ patro: 'TEST', categoriaId: categoriaManual.id, prioritat: 0 });

    eliminaTotsElsMoviments();

    expect(listMovimentsPerComptes([compte.id])).toHaveLength(0);
    expect(listLots()).toHaveLength(0);
    expect(listComptes().map((c) => c.id)).toEqual([compte.id]);
    expect(listCategories().map((c) => c.nom)).toContain('Categoria manual');
    expect(listRegles().map((r) => r.patro)).toContain('TEST');
  });

  it('lets the same account be re-imported fresh afterwards without dedup blocking it', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    const moviment = mov('2026-01-01', 'Test', -100);
    commitImport(compte, [moviment], 'test.txt');

    eliminaTotsElsMoviments();

    const { nous, duplicats } = commitImport(compte, [moviment], 'test.txt');
    expect(nous).toBe(1);
    expect(duplicats).toBe(0);
  });
});

describe('liquidacions de targeta (especificacio.md 3.2.1)', () => {
  it('createReglaLiquidacio refuses a targetaCompteId that is not a targeta account', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    expect(() => createReglaLiquidacio({ patro: 'LIQUIDACION', targetaCompteId: corrent.id })).toThrow();
    expect(listReglesLiquidacio()).toEqual([]);
  });

  it('deleteReglaLiquidacio removes a rule', () => {
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    const regla = createReglaLiquidacio({ patro: 'LIQUIDACION', targetaCompteId: targeta.id });
    deleteReglaLiquidacio(regla.id);
    expect(listReglesLiquidacio()).toEqual([]);
  });

  it('suggereixLiquidacionsTargeta proposes unmarked corrent charges matching a configured pattern', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    createReglaLiquidacio({ patro: 'LIQUIDACION TARJETA', targetaCompteId: targeta.id });
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION TARJETA VISA', -11000)], 'extracte.txt');
    commitImport(corrent, [mov('2026-06-06', 'SUPERMERCAT', -3000)], 'extracte2.txt');

    const suggeriments = suggereixLiquidacionsTargeta();
    expect(suggeriments).toHaveLength(1);
    expect(suggeriments[0].targetaCompteId).toBe(targeta.id);
    expect(suggeriments[0].moviment.concepteOriginal).toBe('LIQUIDACION TARJETA VISA');
  });

  it('marcaLiquidacioTargeta creates a positive counterpart on the card, marks both sides as internal transfers, and reports a perfectly-squared quadratura', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(targeta, [mov('2026-06-01', 'BON AREA', -6000), mov('2026-06-02', 'BENZINERA', -5000)], 'targeta.txt');
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION TARJETA', -11000)], 'corrent.txt');

    const [carrec] = listMovimentsPerComptes([corrent.id]);
    const { contrapartida, quadratura } = marcaLiquidacioTargeta(carrec.id, targeta.id);

    expect(contrapartida.compteId).toBe(targeta.id);
    expect(contrapartida.importCents).toBe(11000);
    expect(contrapartida.dataOperacio).toBe('2026-06-05');
    expect(contrapartida.concepteOriginal).toBe('Liquidació rebuda (contrapartida automàtica)');
    expect(contrapartida.esTransferenciaInterna).toBe(true);
    expect(contrapartida.movimentOrigenId).toBe(carrec.id);
    expect(quadratura).toEqual({ esperatCents: 11000, obtingutCents: 11000, diferenciaCents: 0 });

    const [carrecActualitzat] = listMovimentsPerComptes([corrent.id]);
    expect(carrecActualitzat.esLiquidacioTargetaId).toBe(targeta.id);
    expect(carrecActualitzat.esTransferenciaInterna).toBe(true);

    // El deute de la targeta (suma d'import_cents, veure balance.ts) torna a 0 després de la liquidació.
    const targetaMoviments = listMovimentsPerComptes([targeta.id]);
    expect(targetaMoviments.reduce((s, m) => s + m.importCents, 0)).toBe(0);
  });

  it('reports a non-zero diferenciaCents when the settlement does not match the card movements', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(targeta, [mov('2026-06-01', 'BON AREA', -6000)], 'targeta.txt');
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION TARJETA', -6500)], 'corrent.txt');

    const [carrec] = listMovimentsPerComptes([corrent.id]);
    const { quadratura } = marcaLiquidacioTargeta(carrec.id, targeta.id);
    expect(quadratura).toEqual({ esperatCents: 6000, obtingutCents: 6500, diferenciaCents: 500 });
  });

  it('only counts card movements since the previous settlement when computing quadratura', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(targeta, [mov('2026-05-01', 'COMPRA MAIG', -1000)], 'targeta-maig.txt');
    commitImport(corrent, [mov('2026-05-05', 'LIQUIDACION TARJETA', -1000)], 'corrent-maig.txt');
    const carrecMaig = listMovimentsPerComptes([corrent.id]).find((m) => m.dataOperacio === '2026-05-05')!;
    marcaLiquidacioTargeta(carrecMaig.id, targeta.id);

    commitImport(targeta, [mov('2026-06-01', 'COMPRA JUNY', -2000)], 'targeta-juny.txt');
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION TARJETA', -2000)], 'corrent-juny.txt');
    const carrecJuny = listMovimentsPerComptes([corrent.id]).find((m) => m.dataOperacio === '2026-06-05')!;
    const { quadratura } = marcaLiquidacioTargeta(carrecJuny.id, targeta.id);

    expect(quadratura).toEqual({ esperatCents: 2000, obtingutCents: 2000, diferenciaCents: 0 });
  });

  it('produces the exact same counterpart id when re-marking the same charge (idempotent, e.g. after a reimport)', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION TARJETA', -1000)], 'corrent.txt');
    const [carrec] = listMovimentsPerComptes([corrent.id]);

    const primer = marcaLiquidacioTargeta(carrec.id, targeta.id);
    const segon = marcaLiquidacioTargeta(carrec.id, targeta.id);

    expect(segon.contrapartida.id).toBe(primer.contrapartida.id);
    expect(listMovimentsPerComptes([targeta.id])).toHaveLength(1);
  });

  it('refuses to mark a movement from a targeta account as a settlement', () => {
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(targeta, [mov('2026-06-01', 'BON AREA', -1000)], 'targeta.txt');
    const [movimentTargeta] = listMovimentsPerComptes([targeta.id]);
    expect(() => marcaLiquidacioTargeta(movimentTargeta.id, targeta.id)).toThrow();
  });

  it('desmarcaLiquidacioTargeta removes the counterpart and clears the marker', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION', -1000)], 'corrent.txt');
    const [carrec] = listMovimentsPerComptes([corrent.id]);
    marcaLiquidacioTargeta(carrec.id, targeta.id);
    expect(listMovimentsPerComptes([targeta.id])).toHaveLength(1);

    desmarcaLiquidacioTargeta(carrec.id);

    expect(listMovimentsPerComptes([targeta.id])).toHaveLength(0);
    const [carrecDesmarcat] = listMovimentsPerComptes([corrent.id]);
    expect(carrecDesmarcat.esLiquidacioTargetaId).toBeUndefined();
    expect(carrecDesmarcat.esTransferenciaInterna).toBe(false);
  });

  it('undoing the lot of the marked charge also removes its counterpart on the card (shares lotImportacioId)', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    const { lot } = commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION', -1000)], 'corrent.txt');
    const [carrec] = listMovimentsPerComptes([corrent.id]);
    marcaLiquidacioTargeta(carrec.id, targeta.id);
    expect(listMovimentsPerComptes([targeta.id])).toHaveLength(1);

    undoLot(lot.id);

    expect(listMovimentsPerComptes([corrent.id])).toHaveLength(0);
    expect(listMovimentsPerComptes([targeta.id])).toHaveLength(0);
    expect(listLots()).toHaveLength(0);
  });

  it('eliminaCompte cascades to any regla_liquidacio pointing at the deleted targeta account', () => {
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    createReglaLiquidacio({ patro: 'LIQUIDACION', targetaCompteId: targeta.id });

    eliminaCompte(targeta.id);

    expect(listReglesLiquidacio()).toEqual([]);
  });
});

describe('eliminaMoviment', () => {
  it('deletes a plain movement with no special marking', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    commitImport(corrent, [mov('2026-06-05', 'SUPERMERCAT', -3000)], 'extracte.txt');
    const [m] = listMovimentsPerComptes([corrent.id]);

    eliminaMoviment(m.id);

    expect(listMovimentsPerComptes([corrent.id])).toEqual([]);
  });

  it('throws for a movement id that does not exist', () => {
    expect(() => eliminaMoviment('no-existeix')).toThrow();
  });

  it('deleting the corrent charge marked as a settlement also deletes its virtual counterpart on the card', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION', -1000)], 'corrent.txt');
    const [carrec] = listMovimentsPerComptes([corrent.id]);
    marcaLiquidacioTargeta(carrec.id, targeta.id);
    expect(listMovimentsPerComptes([targeta.id])).toHaveLength(1);

    eliminaMoviment(carrec.id);

    expect(listMovimentsPerComptes([corrent.id])).toEqual([]);
    expect(listMovimentsPerComptes([targeta.id])).toEqual([]);
  });

  it('deleting the virtual counterpart directly restores the origin charge to unmarked', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    commitImport(corrent, [mov('2026-06-05', 'LIQUIDACION', -1000)], 'corrent.txt');
    const [carrec] = listMovimentsPerComptes([corrent.id]);
    const { contrapartida } = marcaLiquidacioTargeta(carrec.id, targeta.id);

    eliminaMoviment(contrapartida.id);

    expect(listMovimentsPerComptes([targeta.id])).toEqual([]);
    const [carrecRestaurat] = listMovimentsPerComptes([corrent.id]);
    expect(carrecRestaurat.esLiquidacioTargetaId).toBeUndefined();
    expect(carrecRestaurat.esTransferenciaInterna).toBe(false);
  });
});

describe('transferències internes suggerides: descartar (spec 3.4)', () => {
  function creaParellaSuggerida() {
    const a = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'A' });
    const b = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'B' });
    commitImport(a, [mov('2026-06-01', 'Transferencia sortint', -5000)], 'a.txt');
    commitImport(b, [mov('2026-06-02', 'Transferencia entrant', 5000)], 'b.txt');
    return { a, b };
  }

  it('descartaTransferencia removes the pair from future suggestions without marking the movements', () => {
    creaParellaSuggerida();
    const [suggeriment] = suggereixTransferencies();
    expect(suggeriment).toBeDefined();

    descartaTransferencia({ a: suggeriment.a, b: suggeriment.b });

    expect(suggereixTransferencies()).toEqual([]);
    const moviments = listMovimentsPerComptes([suggeriment.movimentA.compteId, suggeriment.movimentB.compteId]);
    expect(moviments.every((m) => !m.esTransferenciaInterna)).toBe(true);
  });

  it('descartaTransferencia is idempotent (calling it twice does not throw)', () => {
    creaParellaSuggerida();
    const [suggeriment] = suggereixTransferencies();
    descartaTransferencia({ a: suggeriment.a, b: suggeriment.b });
    expect(() => descartaTransferencia({ a: suggeriment.a, b: suggeriment.b })).not.toThrow();
    expect(suggereixTransferencies()).toEqual([]);
  });

  it('discarding one pair does not affect an unrelated pair', () => {
    creaParellaSuggerida();
    const altres = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'C' });
    const altres2 = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'D' });
    commitImport(altres, [mov('2026-07-01', 'Sortint 2', -2000)], 'c.txt');
    commitImport(altres2, [mov('2026-07-02', 'Entrant 2', 2000)], 'd.txt');

    const suggeriments = suggereixTransferencies();
    expect(suggeriments).toHaveLength(2);
    descartaTransferencia({ a: suggeriments[0].a, b: suggeriments[0].b });

    expect(suggereixTransferencies()).toHaveLength(1);
  });

  it('confirmaTransferencia still works normally for a non-discarded pair', () => {
    creaParellaSuggerida();
    const [suggeriment] = suggereixTransferencies();
    confirmaTransferencia({ a: suggeriment.a, b: suggeriment.b });
    expect(suggereixTransferencies()).toEqual([]);
    const [movimentA] = listMovimentsPerComptes([suggeriment.movimentA.compteId]);
    expect(movimentA.esTransferenciaInterna).toBe(true);
  });

  it('eliminaMoviment cleans up any discarded-pair record referencing the deleted movement', () => {
    creaParellaSuggerida();
    const [suggeriment] = suggereixTransferencies();
    descartaTransferencia({ a: suggeriment.a, b: suggeriment.b });
    expect(listTransferenciesDescartades()).toHaveLength(1);

    eliminaMoviment(suggeriment.a);

    expect(listTransferenciesDescartades()).toEqual([]);
  });

  it('undoLot cleans up any discarded-pair record referencing a movement in the undone lot', () => {
    const a = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'A' });
    const b = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'B' });
    const { lot } = commitImport(a, [mov('2026-06-01', 'Transferencia sortint', -5000)], 'a.txt');
    commitImport(b, [mov('2026-06-02', 'Transferencia entrant', 5000)], 'b.txt');
    const [suggeriment] = suggereixTransferencies();
    descartaTransferencia({ a: suggeriment.a, b: suggeriment.b });
    expect(listTransferenciesDescartades()).toHaveLength(1);

    undoLot(lot.id);

    expect(listTransferenciesDescartades()).toEqual([]);
  });
});

describe('reinicialitzaBaseDades', () => {
  it('wipes every table and reseeds only the default categories (menú de manteniment)', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    commitImport(
      compte,
      [{ dataOperacio: '2026-01-01', dataValor: '2026-01-01', concepteOriginal: 'Test', importCents: -100, saldoPosteriorCents: 900 }],
      'test.txt',
    );
    const categoriaManual = createCategoria('Categoria manual');
    createRegla({ patro: 'TEST', categoriaId: categoriaManual.id, prioritat: 0 });
    const altre = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Altre' });
    commitImport(altre, [mov('2026-01-01', 'Test 2', 100)], 'test2.txt');
    const [suggeriment] = suggereixTransferencies();
    descartaTransferencia({ a: suggeriment.a, b: suggeriment.b });

    reinicialitzaBaseDades();

    expect(listComptes()).toHaveLength(0);
    expect(listMovimentsPerComptes([compte.id])).toHaveLength(0);
    expect(listLots()).toHaveLength(0);
    expect(listRegles()).toHaveLength(0);
    expect(listTransferenciesDescartades()).toEqual([]);

    const categories = listCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.map((c) => c.nom)).toContain('Subministraments');
    expect(categories.map((c) => c.nom)).not.toContain('Categoria manual');
  });
});

describe('recurrents (sub-fase 3.1, especificacio.md 4.1/4.2)', () => {
  it('creaRecurrentManual creates a confirmed, manual-origin recurrent', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    const recurrent = creaRecurrentManual({
      compteId: compte.id,
      concepte: 'Lloguer pis',
      periodicitat: 'mensual',
      importCents: -85000,
      dataPrevista: '2026-08-01',
    });

    expect(recurrent.origen).toBe('manual');
    expect(recurrent.estat).toBe('confirmat');
    expect(recurrent.concepteNormalitzat).toBe('LLOGUER PIS');
    expect(listRecurrents()).toEqual([recurrent]);
  });

  it('creaRecurrentManual accepts periodicitat "unica" for a one-off due date, and an optional categoria/referencia', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const categoria = createCategoria('Proveïdors');

    const recurrent = creaRecurrentManual({
      compteId: compte.id,
      concepte: 'Factura Proveïdor XYZ SL',
      periodicitat: 'unica',
      importCents: -125000,
      dataPrevista: '2026-09-15',
      categoriaId: categoria.id,
      referencia: 'FRA-2026-0042',
    });

    expect(recurrent.periodicitat).toBe('unica');
    expect(recurrent.categoriaId).toBe(categoria.id);
    expect(recurrent.referencia).toBe('FRA-2026-0042');
  });

  it('creaRecurrentManual throws for a compte that does not exist', () => {
    expect(() =>
      creaRecurrentManual({ compteId: 'no-existeix', concepte: 'Test', periodicitat: 'mensual', importCents: -100, dataPrevista: '2026-08-01' }),
    ).toThrow();
  });

  it('creaRecurrentManual throws for a categoriaId that does not exist', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    expect(() =>
      creaRecurrentManual({
        compteId: compte.id,
        concepte: 'Test',
        periodicitat: 'mensual',
        importCents: -100,
        dataPrevista: '2026-08-01',
        categoriaId: 'no-existeix',
      }),
    ).toThrow();
  });

  it('eliminaRecurrent removes the entry', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const recurrent = creaRecurrentManual({
      compteId: compte.id,
      concepte: 'Test',
      periodicitat: 'anual',
      importCents: -5000,
      dataPrevista: '2027-01-01',
    });

    eliminaRecurrent(recurrent.id);

    expect(listRecurrents()).toEqual([]);
  });

  it('eliminaRecurrent throws for an id that does not exist', () => {
    expect(() => eliminaRecurrent('no-existeix')).toThrow();
  });

  it('is included in the JSON backup export/import round-trip', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const recurrent = creaRecurrentManual({
      compteId: compte.id,
      concepte: 'Assegurança',
      periodicitat: 'anual',
      importCents: -30000,
      importAproximat: true,
      dataPrevista: '2027-03-01',
      dataFi: '2028-01-01',
    });

    const backup = exportaCopiaSeguretat();
    expect(backup.recurrents).toEqual([recurrent]);

    importaCopiaSeguretat(backup);

    expect(listRecurrents()).toEqual([recurrent]);
  });

  it('reinicialitzaBaseDades also wipes recurrents', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    creaRecurrentManual({ compteId: compte.id, concepte: 'Test', periodicitat: 'mensual', importCents: -100, dataPrevista: '2026-08-01' });

    reinicialitzaBaseDades();

    expect(listRecurrents()).toEqual([]);
  });

  it('eliminaTotsElsMoviments does not affect recurrents (they are not derived from moviments)', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    commitImport(compte, [mov('2026-06-01', 'Test', -100)], 'test.txt');
    const recurrent = creaRecurrentManual({
      compteId: compte.id,
      concepte: 'Test',
      periodicitat: 'mensual',
      importCents: -100,
      dataPrevista: '2026-08-01',
    });

    eliminaTotsElsMoviments();

    expect(listRecurrents()).toEqual([recurrent]);
  });
});

describe('importaRecurrents (sub-fase 3.2, especificacio.md 4.2)', () => {
  function factura(overrides: Partial<ParsedRecurrentImport> = {}): ParsedRecurrentImport {
    return { concepte: 'Proveïdor XYZ SL', importCents: -125000, dataPrevista: '2026-09-15', ...overrides };
  }

  it('imports a new invoice as origen=importat, estat=confirmat, periodicitat=unica', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    const { nous, duplicats } = importaRecurrents(compte.id, [factura()]);

    expect(nous).toBe(1);
    expect(duplicats).toBe(0);
    const [recurrent] = listRecurrents();
    expect(recurrent).toMatchObject({
      compteId: compte.id,
      concepte: 'Proveïdor XYZ SL',
      importCents: -125000,
      importAproximat: false,
      dataPrevista: '2026-09-15',
      periodicitat: 'unica',
      origen: 'importat',
      estat: 'confirmat',
    });
    expect(recurrent.dataFi).toBeUndefined();
  });

  it('resolves categoriaNom to an existing categoria by case-insensitive name match', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const categoria = createCategoria('Proveïdors');

    importaRecurrents(compte.id, [factura({ categoriaNom: 'proveïdors' })]);

    expect(listRecurrents()[0].categoriaId).toBe(categoria.id);
  });

  it('leaves categoriaId unset when categoriaNom does not match any existing categoria', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    importaRecurrents(compte.id, [factura({ categoriaNom: 'No existeix' })]);

    expect(listRecurrents()[0].categoriaId).toBeUndefined();
  });

  it('preserves referencia', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    importaRecurrents(compte.id, [factura({ referencia: 'FRA-2026-0042' })]);

    expect(listRecurrents()[0].referencia).toBe('FRA-2026-0042');
  });

  it('re-importing the same file does not duplicate rows', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    importaRecurrents(compte.id, [factura()]);

    const { nous, duplicats } = importaRecurrents(compte.id, [factura()]);

    expect(nous).toBe(0);
    expect(duplicats).toBe(1);
    expect(listRecurrents()).toHaveLength(1);
  });

  it('keeps two coincidentally identical invoices in the same batch as separate rows', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    const { nous, duplicats } = importaRecurrents(compte.id, [factura(), factura()]);

    expect(nous).toBe(2);
    expect(duplicats).toBe(0);
    expect(listRecurrents()).toHaveLength(2);
  });

  it('throws for a compte that does not exist', () => {
    expect(() => importaRecurrents('no-existeix', [factura()])).toThrow();
  });

  it('does not touch the database when every row is a duplicate (no-op backup)', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    importaRecurrents(compte.id, [factura()]);

    const { nous, duplicats } = importaRecurrents(compte.id, [factura()]);

    expect(nous).toBe(0);
    expect(duplicats).toBe(1);
  });
});

describe('detectaCandidatsRecurrents (sub-fase 3.3, especificacio.md 4.1)', () => {
  function importaMensual(compte: Parameters<typeof commitImport>[0], concepte: string, importCents: number, fitxer = 'test.txt') {
    commitImport(
      compte,
      ['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => mov(data, concepte, importCents)),
      fitxer,
    );
  }

  it('detects a candidate from corrent-account movements', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    importaMensual(corrent, 'NETFLIX', -1200);

    const [candidat] = detectaCandidatsRecurrents();

    expect(candidat).toMatchObject({ compteId: corrent.id, periodicitat: 'mensual', importEstimatCents: -1200 });
  });

  it('detects a candidate from targeta-account movements too (sub-fase 3.5)', () => {
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    importaMensual(targeta, 'NETFLIX', -1200);

    const [candidat] = detectaCandidatsRecurrents();

    expect(candidat).toMatchObject({ compteId: targeta.id, periodicitat: 'mensual', importEstimatCents: -1200 });
  });

  it('excludes movements marked as internal transfer', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    importaMensual(corrent, 'TRANSFERENCIA PROPIA', -50000);
    for (const m of listMovimentsPerComptes([corrent.id])) {
      setTransferenciaInterna(m.id, true);
    }

    expect(detectaCandidatsRecurrents()).toEqual([]);
  });

  it('excludes a corrent charge marked as a card settlement (and its virtual card counterpart) from detection', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    for (const data of ['2026-01-05', '2026-02-05', '2026-03-05']) {
      commitImport(corrent, [mov(data, 'LIQUIDACION TARGETA', -20000)], 'test.txt');
    }
    for (const carrec of listMovimentsPerComptes([corrent.id])) {
      marcaLiquidacioTargeta(carrec.id, targeta.id);
    }

    expect(detectaCandidatsRecurrents()).toEqual([]);
  });

  it('does not re-surface a candidate once a matching recurrent is already confirmed', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    importaMensual(corrent, 'NETFLIX', -1200);
    expect(detectaCandidatsRecurrents()).toHaveLength(1);

    creaRecurrentManual({ compteId: corrent.id, concepte: 'NETFLIX', periodicitat: 'mensual', importCents: -1200, dataPrevista: '2026-04-05' });

    expect(detectaCandidatsRecurrents()).toEqual([]);
  });

  it('does not re-surface a candidate once ignored (estat=ignorat)', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    importaMensual(corrent, 'NETFLIX', -1200);
    expect(detectaCandidatsRecurrents()).toHaveLength(1);

    getDb()
      .prepare(
        `INSERT INTO recurrents (id, compte_id, concepte, concepte_normalitzat, periodicitat, import_cents, data_prevista, origen, estat)
         VALUES ('ignorat-1', ?, 'NETFLIX', 'NETFLIX', 'mensual', -1200, '2026-04-05', 'detectat', 'ignorat')`,
      )
      .run(corrent.id);

    expect(detectaCandidatsRecurrents()).toEqual([]);
  });

  it('matches an existing recurrent by recomputing the fuzzy key from its raw concepte, even if its stored concepteNormalitzat used the stricter dedup normalization', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    importaMensual(corrent, 'RECIBO ENDESA REF 0012345', -4500);
    expect(detectaCandidatsRecurrents()).toHaveLength(1);

    // creaRecurrentManual stores concepteNormalitzat via the dedup normalization (spec 3.3), which keeps the
    // reference number — unlike the fuzzy recurrence normalization used for detection grouping.
    creaRecurrentManual({
      compteId: corrent.id,
      concepte: 'RECIBO ENDESA REF 0012345',
      periodicitat: 'mensual',
      importCents: -4500,
      dataPrevista: '2026-04-05',
    });

    expect(detectaCandidatsRecurrents()).toEqual([]);
  });

  it('returns an empty list when there are no accounts at all', () => {
    expect(detectaCandidatsRecurrents()).toEqual([]);
  });

  it('returns an empty list for an account with no movements', () => {
    createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    expect(detectaCandidatsRecurrents()).toEqual([]);
  });
});

describe('detectaCandidatsRecurrents: targeta amb liquidació configurada (sub-fase 3.5, especificacio.md 3.2.1)', () => {
  // Ocurrències construïdes relatives a "ara" (no a dates fixes de 2026): la
  // darrera cau sempre més d'un any en el futur, així que la "propera
  // ocurrència" (última + 1 mes, dia 5) mai necessita cap projecció addicional
  // cap endavant (recurrenceDetection.ts `properaOcurrencia`) i el test és
  // determinista independentment de quin dia real s'executi la suite.
  function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function importaMensual(compte: Parameters<typeof commitImport>[0], concepte: string, importCents: number, fitxer = 'test.txt') {
    const ara = new Date();
    const dates = [13, 14, 15].map((mesosEndavant) => iso(new Date(ara.getFullYear(), ara.getMonth() + mesosEndavant, 5)));
    commitImport(
      compte,
      dates.map((data) => mov(data, concepte, importCents)),
      fitxer,
    );
    const ultimaOcurrencia = new Date(dates[2]);
    const properaOcurrenciaCrua = new Date(ultimaOcurrencia.getFullYear(), ultimaOcurrencia.getMonth() + 1, 5);
    return { properaOcurrenciaCrua };
  }

  it("uses the targeta's next settlement date instead of the raw next charge date when compteLiquidacioId/diaLiquidacio are configured", () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    actualitzaCompte(targeta.id, { compteLiquidacioId: corrent.id, diaLiquidacio: 20 });
    const { properaOcurrenciaCrua } = importaMensual(targeta, 'NETFLIX', -1200);

    const [candidat] = detectaCandidatsRecurrents();

    // El dia de liquidació (20) del mateix mes de la propera ocurrència crua (dia 5) encara no ha passat, així que hi cau.
    expect(candidat.compteId).toBe(targeta.id);
    expect(candidat.dataPrevista).toBe(iso(new Date(properaOcurrenciaCrua.getFullYear(), properaOcurrenciaCrua.getMonth(), 20)));
  });

  it('keeps the raw next-charge date for a targeta without a settlement account/day configured', () => {
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    const { properaOcurrenciaCrua } = importaMensual(targeta, 'NETFLIX', -1200);

    const [candidat] = detectaCandidatsRecurrents();

    expect(candidat.dataPrevista).toBe(iso(properaOcurrenciaCrua));
  });

  it('keeps the raw next-charge date for a targeta with compteLiquidacioId but no diaLiquidacio', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const targeta = createCompte({ banc: 'sabadell', tipus: 'targeta', alias: 'Targeta' });
    actualitzaCompte(targeta.id, { compteLiquidacioId: corrent.id });
    const { properaOcurrenciaCrua } = importaMensual(targeta, 'NETFLIX', -1200);

    const [candidat] = detectaCandidatsRecurrents();

    expect(candidat.dataPrevista).toBe(iso(properaOcurrenciaCrua));
  });

  it('does not affect a corrent-account candidate (settlement logic only applies to targeta)', () => {
    const corrent = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const { properaOcurrenciaCrua } = importaMensual(corrent, 'NOMINA', 180000);

    const [candidat] = detectaCandidatsRecurrents();

    expect(candidat.dataPrevista).toBe(iso(properaOcurrenciaCrua));
  });
});

describe('confirmaCandidatRecurrent / ignoraCandidatRecurrent / actualitzaRecurrent (sub-fase 3.4, especificacio.md 4.1.5)', () => {
  function dades(compteId: string, overrides: Partial<Parameters<typeof creaRecurrentManual>[0]> = {}) {
    return {
      compteId,
      concepte: 'NETFLIX',
      periodicitat: 'mensual' as const,
      importCents: -1200,
      dataPrevista: '2026-05-05',
      ...overrides,
    };
  }

  it('confirmaCandidatRecurrent creates a confirmed recurrent with origen=detectat', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    const recurrent = confirmaCandidatRecurrent(dades(compte.id));

    expect(recurrent.origen).toBe('detectat');
    expect(recurrent.estat).toBe('confirmat');
    expect(listRecurrents()).toEqual([recurrent]);
  });

  it('confirmaCandidatRecurrent persists corrections made before confirming (periodicitat/import/data/categoria)', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const categoria = createCategoria('Oci');

    const recurrent = confirmaCandidatRecurrent(dades(compte.id, { periodicitat: 'anual', importCents: -1500, categoriaId: categoria.id }));

    expect(recurrent).toMatchObject({ periodicitat: 'anual', importCents: -1500, categoriaId: categoria.id });
  });

  it('once confirmed, the same pattern no longer surfaces as a candidate', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    commitImport(
      compte,
      ['2026-01-05', '2026-02-05', '2026-03-05'].map((data) => ({
        dataOperacio: data,
        dataValor: data,
        concepteOriginal: 'NETFLIX',
        importCents: -1200,
        saldoPosteriorCents: null,
      })),
      'test.txt',
    );
    const [candidat] = detectaCandidatsRecurrents();

    confirmaCandidatRecurrent({
      compteId: candidat.compteId,
      concepte: candidat.concepte,
      periodicitat: candidat.periodicitat,
      importCents: candidat.importEstimatCents,
      dataPrevista: candidat.dataPrevista,
    });

    expect(detectaCandidatsRecurrents()).toEqual([]);
  });

  it('ignoraCandidatRecurrent creates an ignored recurrent with origen=detectat', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    const recurrent = ignoraCandidatRecurrent(dades(compte.id));

    expect(recurrent.origen).toBe('detectat');
    expect(recurrent.estat).toBe('ignorat');
  });

  it('confirmaCandidatRecurrent/ignoraCandidatRecurrent throw for a compte that does not exist', () => {
    expect(() => confirmaCandidatRecurrent(dades('no-existeix'))).toThrow();
    expect(() => ignoraCandidatRecurrent(dades('no-existeix'))).toThrow();
  });

  it('actualitzaRecurrent updates the given fields and recomputes concepteNormalitzat when concepte changes', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const recurrent = creaRecurrentManual(dades(compte.id));

    actualitzaRecurrent(recurrent.id, { concepte: 'NETFLIX PREMIUM', importCents: -1799 });

    const [actualitzat] = listRecurrents();
    expect(actualitzat.concepte).toBe('NETFLIX PREMIUM');
    expect(actualitzat.concepteNormalitzat).toBe('NETFLIX PREMIUM');
    expect(actualitzat.importCents).toBe(-1799);
  });

  it('actualitzaRecurrent can clear an optional field by setting it to null', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const categoria = createCategoria('Oci');
    const recurrent = creaRecurrentManual(dades(compte.id, { categoriaId: categoria.id }));

    actualitzaRecurrent(recurrent.id, { categoriaId: null });

    expect(listRecurrents()[0].categoriaId).toBeUndefined();
  });

  it('actualitzaRecurrent throws for a recurrent that does not exist', () => {
    expect(() => actualitzaRecurrent('no-existeix', { importCents: -100 })).toThrow();
  });

  it('actualitzaRecurrent throws for a categoriaId that does not exist', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const recurrent = creaRecurrentManual(dades(compte.id));

    expect(() => actualitzaRecurrent(recurrent.id, { categoriaId: 'no-existeix' })).toThrow();
  });

  it('defaults importAproximat to false and dataFi to unset when not provided', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    const recurrent = creaRecurrentManual(dades(compte.id));

    expect(recurrent.importAproximat).toBe(false);
    expect(recurrent.dataFi).toBeUndefined();
  });

  it('creaRecurrentManual accepts importAproximat and dataFi', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });

    const recurrent = creaRecurrentManual(dades(compte.id, { importAproximat: true, dataFi: '2027-12-31' }));

    expect(recurrent.importAproximat).toBe(true);
    expect(recurrent.dataFi).toBe('2027-12-31');
    expect(listRecurrents()[0]).toMatchObject({ importAproximat: true, dataFi: '2027-12-31' });
  });

  it('actualitzaRecurrent updates importAproximat and dataFi, and can clear dataFi with null', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Corrent' });
    const recurrent = creaRecurrentManual(dades(compte.id));

    actualitzaRecurrent(recurrent.id, { importAproximat: true, dataFi: '2027-06-30' });
    expect(listRecurrents()[0]).toMatchObject({ importAproximat: true, dataFi: '2027-06-30' });

    actualitzaRecurrent(recurrent.id, { dataFi: null });
    expect(listRecurrents()[0].dataFi).toBeUndefined();
  });
});
