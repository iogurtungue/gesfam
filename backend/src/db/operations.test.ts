import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedMoviment } from '../parsers/types.ts';

process.env.GESFAM_DB_PATH = ':memory:';
const { getDb } = await import('./client.ts');
const {
  commitImport,
  countMovimentsCompte,
  createCategoria,
  createCompte,
  createRegla,
  eliminaCompte,
  eliminaTotsElsMoviments,
  listCategories,
  listComptes,
  listLots,
  listMovimentsPerComptes,
  listRegles,
  reinicialitzaBaseDades,
  renombraCategoria,
  renombraCompte,
  setMovimentCategoria,
} = await import('./operations.ts');

beforeEach(() => {
  getDb().exec('DELETE FROM moviments; DELETE FROM lots; DELETE FROM regles; DELETE FROM categories; DELETE FROM comptes;');
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

describe('renombraCompte', () => {
  it('updates the alias without touching anything else', () => {
    const compte = createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Nom original' });
    renombraCompte(compte.id, 'Nom nou');
    const [actualitzat] = listComptes();
    expect(actualitzat.alias).toBe('Nom nou');
    expect(actualitzat.id).toBe(compte.id);
    expect(actualitzat.banc).toBe('sabadell');
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
