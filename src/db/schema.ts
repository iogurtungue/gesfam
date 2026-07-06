import Dexie, { type EntityTable } from 'dexie';
import type { Categoria, Compte, LotImportacio, Moviment, ReglaCategoritzacio } from './types';

export const DEFAULT_CATEGORIES = [
  'Habitatge',
  'Subministraments',
  'Alimentació',
  'Transport',
  'Nòmina',
  'Impostos',
  'Oci',
  'Transferències internes',
  'Altres',
];

export class GesFamDB extends Dexie {
  comptes!: EntityTable<Compte, 'id'>;
  moviments!: EntityTable<Moviment, 'id'>;
  lots!: EntityTable<LotImportacio, 'id'>;
  categories!: EntityTable<Categoria, 'id'>;
  regles!: EntityTable<ReglaCategoritzacio, 'id'>;

  constructor() {
    super('gesfam');
    this.version(1).stores({
      comptes: 'id, banc, tipus',
      moviments: 'id, compteId, dataOperacio, lotImportacioId',
      lots: 'id, compteId, data',
    });
    this.version(2)
      .stores({
        comptes: 'id, banc, tipus',
        moviments: 'id, compteId, dataOperacio, lotImportacioId, categoriaId',
        lots: 'id, compteId, data',
        categories: 'id, nom',
        regles: 'id, prioritat, categoriaId',
      })
      // Runs when an *existing* (Phase 1) database upgrades to this version.
      .upgrade(async (tx) => {
        const count = await tx.table('categories').count();
        if (count === 0) {
          await tx.table('categories').bulkAdd(DEFAULT_CATEGORIES.map((nom) => ({ id: crypto.randomUUID(), nom })));
        }
      });
    this.version(3)
      .stores({
        comptes: 'id, banc, tipus',
        moviments: 'id, compteId, dataOperacio, lotImportacioId, categoriaId, seq',
        lots: 'id, compteId, data',
        categories: 'id, nom',
        regles: 'id, prioritat, categoriaId',
      })
      // Backfills `seq` for movements imported before this field existed.
      // True original file order can't be recovered at this point, so this
      // is a best-effort deterministic ordering (by date, then by the
      // import batch's timestamp) rather than a correctness fix for old data —
      // every import going forward gets exact file order via commitImport().
      .upgrade(async (tx) => {
        const [moviments, lots] = await Promise.all([tx.table('moviments').toArray(), tx.table('lots').toArray()]);
        const dataLot = new Map(lots.map((l) => [l.id, l.data]));
        const ordenats = [...moviments].sort((a, b) => {
          return (
            a.dataOperacio.localeCompare(b.dataOperacio) ||
            (dataLot.get(a.lotImportacioId) ?? '').localeCompare(dataLot.get(b.lotImportacioId) ?? '')
          );
        });
        await Promise.all(ordenats.map((m, seq) => tx.table('moviments').update(m.id, { seq })));
      });
    // Runs only the very first time the database is created (no prior version
    // ever existed) — 'upgrade' above never fires in that case, so without
    // this a brand-new install would have zero default categories.
    this.on('populate', async () => {
      await this.categories.bulkAdd(DEFAULT_CATEGORIES.map((nom) => ({ id: crypto.randomUUID(), nom })));
    });
  }
}

export const db = new GesFamDB();
