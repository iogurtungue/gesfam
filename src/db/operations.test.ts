import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import {
  commitImport,
  countMovimentsCompte,
  createCategoria,
  createCompte,
  createRegla,
  eliminaCompte,
  eliminaTotsElsMoviments,
  listCategories,
  listComptes,
  listMovimentsPerComptes,
  listRegles,
  reinicialitzaBaseDades,
  renombraCategoria,
  renombraCompte,
} from './operations';
import type { ParsedMoviment } from '../parsers/types';

beforeEach(async () => {
  await Promise.all([
    db.comptes.clear(),
    db.moviments.clear(),
    db.lots.clear(),
    db.categories.clear(),
    db.regles.clear(),
  ]);
});

function mov(dataOperacio: string, concepteOriginal: string, importCents: number): ParsedMoviment {
  return { dataOperacio, dataValor: dataOperacio, concepteOriginal, importCents, saldoPosteriorCents: null };
}

describe('commitImport', () => {
  it('assigns seq in file order so same-day movements can be told apart later (bug: llista no ordenada quan la data coincideix)', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    // Three movements sharing the same date, in a specific file order.
    await commitImport(
      compte,
      [mov('2026-06-05', 'Primer del dia', -100), mov('2026-06-05', 'Segon del dia', -200), mov('2026-06-05', 'Tercer del dia', -300)],
      'extracte.txt',
    );

    const moviments = await listMovimentsPerComptes([compte.id]);
    const perOrdreDeSeq = [...moviments].sort((a, b) => a.seq - b.seq);
    expect(perOrdreDeSeq.map((m) => m.concepteOriginal)).toEqual(['Primer del dia', 'Segon del dia', 'Tercer del dia']);
  });

  it('keeps seq strictly increasing across separate import calls, never restarting', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    await commitImport(compte, [mov('2026-06-01', 'Primera importació', -100)], 'lot1.txt');
    await commitImport(compte, [mov('2026-06-02', 'Segona importació', -200)], 'lot2.txt');

    const moviments = await listMovimentsPerComptes([compte.id]);
    const primera = moviments.find((m) => m.concepteOriginal === 'Primera importació')!;
    const segona = moviments.find((m) => m.concepteOriginal === 'Segona importació')!;
    expect(segona.seq).toBeGreaterThan(primera.seq);
  });
});

describe('listCategories', () => {
  it('returns categories sorted alphabetically, not in insertion order', async () => {
    await createCategoria('Transport');
    await createCategoria('Alimentació');
    await createCategoria('Nòmina');

    const categories = await listCategories();
    expect(categories.map((c) => c.nom)).toEqual(['Alimentació', 'Nòmina', 'Transport']);
  });
});

describe('renombraCategoria', () => {
  it('updates the category name', async () => {
    const categoria = await createCategoria('Nom antic');
    await renombraCategoria(categoria.id, 'Nom nou');
    const [actualitzada] = await listCategories();
    expect(actualitzada.nom).toBe('Nom nou');
    expect(actualitzada.id).toBe(categoria.id);
  });
});

describe('renombraCompte', () => {
  it('updates the alias without touching anything else', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Nom original' });
    await renombraCompte(compte.id, 'Nom nou');
    const [actualitzat] = await listComptes();
    expect(actualitzat.alias).toBe('Nom nou');
    expect(actualitzat.id).toBe(compte.id);
    expect(actualitzat.banc).toBe('sabadell');
  });
});

describe('eliminaCompte', () => {
  it('deletes an account with no movements, and its own (empty) import batches', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte buit' });
    // An import that results in zero new movements (e.g. everything was a
    // duplicate) still creates a lot — that lot must go with the account.
    await commitImport(compte, [], 'buit.txt');
    expect(await countMovimentsCompte(compte.id)).toBe(0);

    await eliminaCompte(compte.id);

    expect(await listComptes()).toEqual([]);
    expect(await db.lots.where({ compteId: compte.id }).count()).toBe(0);
  });

  it('refuses to delete an account that has movements', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte amb moviments' });
    await commitImport(compte, [mov('2026-01-01', 'Test', -100)], 'test.txt');

    await expect(eliminaCompte(compte.id)).rejects.toThrow();

    expect(await listComptes()).toHaveLength(1);
    expect(await countMovimentsCompte(compte.id)).toBe(1);
  });
});

describe('eliminaTotsElsMoviments', () => {
  it('clears moviments and lots but keeps comptes, categories and regles intact', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    await commitImport(compte, [mov('2026-01-01', 'Test', -100)], 'test.txt');
    const categoriaManual = await createCategoria('Categoria manual');
    await createRegla({ patro: 'TEST', categoriaId: categoriaManual.id, prioritat: 0 });

    await eliminaTotsElsMoviments();

    expect(await db.moviments.count()).toBe(0);
    expect(await db.lots.count()).toBe(0);
    expect((await listComptes()).map((c) => c.id)).toEqual([compte.id]);
    expect((await listCategories()).map((c) => c.nom)).toContain('Categoria manual');
    expect((await listRegles()).map((r) => r.patro)).toContain('TEST');
  });

  it('lets the same account be re-imported fresh afterwards without dedup blocking it', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    const moviment = mov('2026-01-01', 'Test', -100);
    await commitImport(compte, [moviment], 'test.txt');

    await eliminaTotsElsMoviments();

    const { nous, duplicats } = await commitImport(compte, [moviment], 'test.txt');
    expect(nous).toBe(1);
    expect(duplicats).toBe(0);
  });
});

describe('reinicialitzaBaseDades', () => {
  it('wipes every table and reseeds only the default categories (menú de manteniment)', async () => {
    const compte = await createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Compte de prova' });
    await commitImport(
      compte,
      [{ dataOperacio: '2026-01-01', dataValor: '2026-01-01', concepteOriginal: 'Test', importCents: -100, saldoPosteriorCents: 900 }],
      'test.txt',
    );
    const categoriaManual = await createCategoria('Categoria manual');
    await createRegla({ patro: 'TEST', categoriaId: categoriaManual.id, prioritat: 0 });

    await reinicialitzaBaseDades();

    expect(await db.comptes.count()).toBe(0);
    expect(await db.moviments.count()).toBe(0);
    expect(await db.lots.count()).toBe(0);
    expect(await db.regles.count()).toBe(0);

    const categories = await listCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.map((c) => c.nom)).toContain('Subministraments');
    expect(categories.map((c) => c.nom)).not.toContain('Categoria manual');
  });
});
