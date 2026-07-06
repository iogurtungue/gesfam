import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { GesFamDB } from './schema';

// Regression test for a real bug: Dexie's version(N).upgrade() callback only
// runs when migrating an *existing* database. It never fires for a brand-new
// database (Dexie jumps straight to creating the latest schema), so seeding
// default categories only in `.upgrade()` silently left fresh installs with
// zero categories. The fix uses the `populate` event, which fires exactly
// once, only on first-ever creation.

afterEach(async () => {
  await Dexie.delete('gesfam');
});

describe('GesFamDB', () => {
  it('seeds default categories on a brand-new database', async () => {
    const db = new GesFamDB();
    await db.open();
    const categories = await db.categories.toArray();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.map((c) => c.nom)).toContain('Subministraments');
    db.close();
  });

  it('does not duplicate categories if the database is reopened', async () => {
    const db1 = new GesFamDB();
    await db1.open();
    const countAfterFirstOpen = await db1.categories.count();
    db1.close();

    const db2 = new GesFamDB();
    await db2.open();
    const countAfterReopen = await db2.categories.count();
    db2.close();

    expect(countAfterReopen).toBe(countAfterFirstOpen);
  });

  it('backfills seq for movements from a real pre-existing v2 database (upgrade path, not just fresh installs)', async () => {
    // Simulate a user who already has Phase 2 data (no `seq` field yet) by
    // building the database up to version 2 only, exactly as the app used to.
    class GesFamDBv2 extends Dexie {
      constructor() {
        super('gesfam');
        this.version(1).stores({
          comptes: 'id, banc, tipus',
          moviments: 'id, compteId, dataOperacio, lotImportacioId',
          lots: 'id, compteId, data',
        });
        this.version(2).stores({
          comptes: 'id, banc, tipus',
          moviments: 'id, compteId, dataOperacio, lotImportacioId, categoriaId',
          lots: 'id, compteId, data',
          categories: 'id, nom',
          regles: 'id, prioritat, categoriaId',
        });
      }
    }

    const v2 = new GesFamDBv2();
    await v2.open();
    await v2.table('lots').add({ id: 'lot-1', data: '2026-06-01T00:00:00.000Z', fitxerOrigen: 'x.txt', banc: 'sabadell', compteId: 'c1', nombreMoviments: 2 });
    await v2.table('moviments').bulkAdd([
      { id: 'm1', compteId: 'c1', dataOperacio: '2026-06-05', dataValor: '2026-06-05', concepteOriginal: 'A', concepteNormalitzat: 'A', importCents: -100, saldoPosteriorCents: 900, lotImportacioId: 'lot-1' },
      { id: 'm2', compteId: 'c1', dataOperacio: '2026-06-05', dataValor: '2026-06-05', concepteOriginal: 'B', concepteNormalitzat: 'B', importCents: -200, saldoPosteriorCents: 700, lotImportacioId: 'lot-1' },
    ]);
    v2.close();

    const upgraded = new GesFamDB();
    await upgraded.open();
    const moviments = await upgraded.moviments.toArray();
    expect(moviments).toHaveLength(2);
    // Every pre-existing movement got a distinct, defined seq — that's the
    // correctness property the upgrade must guarantee (exact historical file
    // order for old data can't be recovered, but every row must be orderable).
    expect(moviments.every((m) => typeof m.seq === 'number')).toBe(true);
    expect(new Set(moviments.map((m) => m.seq)).size).toBe(2);
    upgraded.close();
  });
});
