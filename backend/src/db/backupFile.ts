import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { closeDb, DADES_DIR, DB_PATH, getDb } from './client.ts';
import { getConfiguracio } from './configuracio.ts';

const BACKUPS_DIR = path.join(DADES_DIR, 'backups');

function isValidBackupFilename(filename: string): boolean {
  return (
    filename.startsWith('finances-') &&
    filename.endsWith('.db') &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('..')
  );
}

/**
 * Copies the live .db file to dades/backups/ with a timestamp, before every
 * import and destructive operation (spec section 2: "Còpies de seguretat").
 * Checkpoints WAL first so the copy is a complete, self-contained snapshot —
 * a plain file copy while in WAL mode could miss recent writes still sitting
 * in the -wal file. Keeps only the last `maxBackups` files (overridable for
 * tests; defaults to the configured `maxCopiesSeguretat`, especificacio.md 4.4).
 */
export function backupDbFile(maxBackups?: number): void {
  if (DB_PATH === ':memory:' || !fs.existsSync(DB_PATH)) return;

  maxBackups ??= getConfiguracio().maxCopiesSeguretat;

  getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');

  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // A short random suffix guards against filename collisions when two
  // backups happen to fire within the same millisecond (e.g. in tests).
  const suffix = randomUUID().slice(0, 8);
  fs.copyFileSync(DB_PATH, path.join(BACKUPS_DIR, `finances-${timestamp}-${suffix}.db`));

  const backups = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('finances-') && f.endsWith('.db'))
    .sort();
  const excess = backups.length - maxBackups;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(BACKUPS_DIR, backups[i]));
  }
}

export interface BackupFileInfo {
  filename: string;
  creatEl: string;
  midaBytes: number;
}

/** Lists the automatic .db backups, newest first, for the "Manteniment" restore UI. */
export function listBackupFiles(): BackupFileInfo[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter(isValidBackupFilename)
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, filename));
      return { filename, creatEl: stat.mtime.toISOString(), midaBytes: stat.size };
    })
    .sort((a, b) => b.creatEl.localeCompare(a.creatEl));
}

/**
 * Restores the live database from one of the automatic backups, overwriting
 * all current data. Takes a fresh backup of the current state first — a bad
 * pick here shouldn't be any more unrecoverable than the mistake it's fixing.
 * Closes the connection and clears the old file's WAL/SHM sidecars before
 * copying over it; leaving them in place would let SQLite reconcile the
 * restored main file against journal pages that belong to a different
 * database entirely.
 */
export function restoreBackup(filename: string): void {
  if (!isValidBackupFilename(filename)) {
    throw new Error(`Nom de fitxer de còpia de seguretat no vàlid: "${filename}".`);
  }
  if (DB_PATH === ':memory:') {
    throw new Error('No es pot restaurar una còpia de seguretat en mode de proves (:memory:).');
  }
  const source = path.join(BACKUPS_DIR, filename);
  if (!fs.existsSync(source)) {
    throw new Error(`No s'ha trobat la còpia de seguretat "${filename}".`);
  }

  backupDbFile();
  closeDb();
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = DB_PATH + suffix;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }
  fs.copyFileSync(source, DB_PATH);
  getDb();
}
