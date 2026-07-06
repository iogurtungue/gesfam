import fs from 'node:fs';
import { importaCopiaSeguretat, type Backup } from './db/operations.ts';
import { DB_PATH } from './db/client.ts';

function esBackupValid(data: unknown): data is Backup {
  if (typeof data !== 'object' || data === null) return false;
  const b = data as Record<string, unknown>;
  return (
    b.versio === 1 &&
    Array.isArray(b.comptes) &&
    Array.isArray(b.moviments) &&
    Array.isArray(b.lots) &&
    Array.isArray(b.categories) &&
    Array.isArray(b.regles)
  );
}

/**
 * One-off migration: loads a GesFam JSON backup (exported from the old
 * Dexie/IndexedDB-based frontend, via the "Còpia de seguretat" tab) into the
 * new SQLite database. Run with: npm run migrate-json --workspace backend -- <path-to-backup.json>
 *
 * Reading an existing JSON export rather than reaching into the browser's
 * IndexedDB directly is deliberate — this script can only ever see what was
 * exported, so if data is missing, re-export a fresh backup from the old
 * frontend and rerun this.
 */
function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Ús: tsx src/migrateFromJson.ts <ruta-al-fitxer-de-copia-de-seguretat.json>');
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const data: unknown = JSON.parse(raw);
  if (!esBackupValid(data)) {
    console.error(`"${filePath}" no té el format esperat d'una còpia de seguretat de GesFam.`);
    process.exit(1);
  }

  console.log(`Migrant des de ${filePath} (exportat el ${data.exportatEl}) cap a ${DB_PATH}...`);
  importaCopiaSeguretat(data);

  console.log('Fet:');
  console.log(`  comptes: ${data.comptes.length}`);
  console.log(`  moviments: ${data.moviments.length}`);
  console.log(`  lots: ${data.lots.length}`);
  console.log(`  categories: ${data.categories.length}`);
  console.log(`  regles: ${data.regles.length}`);
}

main();
