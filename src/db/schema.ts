import Dexie, { type EntityTable } from 'dexie';
import type { Compte, LotImportacio, Moviment } from './types';

export class GesFamDB extends Dexie {
  comptes!: EntityTable<Compte, 'id'>;
  moviments!: EntityTable<Moviment, 'id'>;
  lots!: EntityTable<LotImportacio, 'id'>;

  constructor() {
    super('gesfam');
    this.version(1).stores({
      comptes: 'id, banc, tipus',
      moviments: 'id, compteId, dataOperacio, lotImportacioId',
      lots: 'id, compteId, data',
    });
  }
}

export const db = new GesFamDB();
