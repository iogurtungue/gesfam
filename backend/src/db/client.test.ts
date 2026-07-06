import { afterEach, describe, expect, it } from 'vitest';

process.env.GESFAM_DB_PATH = ':memory:';
const { getDb, closeDb } = await import('./client.ts');

describe('getDb', () => {
  afterEach(() => {
    closeDb();
  });

  it('applies migrations and seeds default categories on a fresh database', () => {
    const db = getDb();
    const categories = db.prepare('SELECT id, nom FROM categories ORDER BY nom').all() as { id: string; nom: string }[];
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.map((c) => c.nom)).toContain('Subministraments');
  });

  it('records applied migrations and does not re-apply them on reopen', () => {
    const db1 = getDb();
    const countBefore = (db1.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
    closeDb();

    const db2 = getDb();
    const countAfter = (db2.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
    expect(countAfter).toBe(countBefore);

    const migrations = db2.prepare('SELECT name FROM _migrations').all() as { name: string }[];
    expect(migrations.map((m) => m.name)).toContain('001_init.sql');
  });

  it('creates all expected tables', () => {
    const db = getDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    for (const expected of ['comptes', 'moviments', 'lots', 'categories', 'regles']) {
      expect(tables).toContain(expected);
    }
  });
});
