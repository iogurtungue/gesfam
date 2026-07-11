import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedMoviment } from '../parsers/types.ts';

process.env.GESFAM_DB_PATH = ':memory:';
const { getDb } = await import('./client.ts');
const {
  actualitzaCompte,
  actualitzaRegla,
  commitImport,
  countMovimentsCompte,
  createCategoria,
  createCompte,
  createRegla,
  createReglaLiquidacio,
  deleteReglaLiquidacio,
  desmarcaLiquidacioTargeta,
  eliminaCompte,
  eliminaMoviment,
  eliminaTotsElsMoviments,
  listCategories,
  listComptes,
  listLots,
  listMovimentsPerComptes,
  listReglesLiquidacio,
  listRegles,
  marcaLiquidacioTargeta,
  reinicialitzaBaseDades,
  renombraCategoria,
  setMovimentCategoria,
  suggereixLiquidacionsTargeta,
  undoLot,
} = await import('./operations.ts');

beforeEach(() => {
  getDb().exec(
    'DELETE FROM moviments; DELETE FROM lots; DELETE FROM regles; DELETE FROM regles_liquidacio; DELETE FROM categories; DELETE FROM comptes;',
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

    reinicialitzaBaseDades();

    expect(listComptes()).toHaveLength(0);
    expect(listMovimentsPerComptes([compte.id])).toHaveLength(0);
    expect(listLots()).toHaveLength(0);
    expect(listRegles()).toHaveLength(0);

    const categories = listCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.map((c) => c.nom)).toContain('Subministraments');
    expect(categories.map((c) => c.nom)).not.toContain('Categoria manual');
  });
});
