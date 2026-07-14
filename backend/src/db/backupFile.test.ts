import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dadesDir: string;

beforeEach(() => {
  // Fresh module registry each test: client.ts/backupFile.ts read
  // GESFAM_DADES_DIR/GESFAM_DB_PATH into module-level constants exactly once
  // at first import, so a stale cached module would ignore this test's env.
  vi.resetModules();
  dadesDir = path.join(os.tmpdir(), `gesfam-test-${randomUUID()}`);
  process.env.GESFAM_DADES_DIR = dadesDir;
  process.env.GESFAM_DB_PATH = path.join(dadesDir, 'finances.db');
});

afterEach(async () => {
  const { closeDb } = await import('./client.ts');
  closeDb();
  fs.rmSync(dadesDir, { recursive: true, force: true });
  delete process.env.GESFAM_DADES_DIR;
  delete process.env.GESFAM_DB_PATH;
});

describe('backupDbFile', () => {
  it('does nothing if the database file does not exist yet', async () => {
    const { backupDbFile } = await import('./backupFile.ts');
    backupDbFile();
    expect(fs.existsSync(path.join(dadesDir, 'backups'))).toBe(false);
  });

  it('creates a timestamped copy once the database exists', async () => {
    const { getDb } = await import('./client.ts');
    const { backupDbFile } = await import('./backupFile.ts');
    getDb(); // creates the file on disk

    backupDbFile();

    const backups = fs.readdirSync(path.join(dadesDir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^finances-.*\.db$/);
  });

  it('keeps only the most recent maxBackups files', async () => {
    const { getDb } = await import('./client.ts');
    const { backupDbFile } = await import('./backupFile.ts');
    getDb();

    for (let i = 0; i < 5; i++) {
      backupDbFile(3);
    }

    const backups = fs.readdirSync(path.join(dadesDir, 'backups'));
    expect(backups).toHaveLength(3);
  });

  it('defaults to the configured maxCopiesSeguretat (especificacio.md 4.4) when no override is given', async () => {
    const { getDb } = await import('./client.ts');
    const { actualitzaConfiguracio } = await import('./configuracio.ts');
    const { backupDbFile } = await import('./backupFile.ts');
    getDb();
    actualitzaConfiguracio({ maxCopiesSeguretat: 2 });

    for (let i = 0; i < 5; i++) {
      backupDbFile();
    }

    const backups = fs.readdirSync(path.join(dadesDir, 'backups'));
    expect(backups).toHaveLength(2);
  });
});

describe('listBackupFiles', () => {
  it('returns an empty list when no backups exist yet', async () => {
    const { listBackupFiles } = await import('./backupFile.ts');
    expect(listBackupFiles()).toEqual([]);
  });

  it('lists backups newest first, with filename and size', async () => {
    const { getDb } = await import('./client.ts');
    const { backupDbFile, listBackupFiles } = await import('./backupFile.ts');
    getDb();
    backupDbFile();
    await new Promise((r) => setTimeout(r, 5));
    backupDbFile();

    const backups = listBackupFiles();
    expect(backups).toHaveLength(2);
    expect(backups[0].creatEl >= backups[1].creatEl).toBe(true);
    expect(backups[0].midaBytes).toBeGreaterThan(0);
  });
});

describe('restoreBackup', () => {
  it('replaces current data with the chosen backup, after taking a safety backup of the current state', async () => {
    const { createCompte, listComptes } = await import('./operations.ts');
    const { backupDbFile, listBackupFiles, restoreBackup } = await import('./backupFile.ts');

    createCompte({ banc: 'sabadell', tipus: 'corrent', alias: 'Abans de la còpia' });
    backupDbFile();
    const [primeraCopia] = listBackupFiles();

    createCompte({ banc: 'ing', tipus: 'corrent', alias: 'Després de la còpia' });
    expect(listComptes()).toHaveLength(2);

    restoreBackup(primeraCopia.filename);

    expect(listComptes().map((c) => c.alias)).toEqual(['Abans de la còpia']);
    // restoreBackup takes its own safety backup first, so there should be more than the one we made manually.
    expect(listBackupFiles().length).toBeGreaterThan(1);
  });

  it('rejects a filename that does not look like a backup file (path traversal guard)', async () => {
    const { restoreBackup } = await import('./backupFile.ts');
    expect(() => restoreBackup('../../etc/passwd')).toThrow();
    expect(() => restoreBackup('finances-../evil.db')).toThrow();
  });

  it('rejects a backup filename that does not exist', async () => {
    const { getDb } = await import('./client.ts');
    const { restoreBackup } = await import('./backupFile.ts');
    getDb();
    expect(() => restoreBackup('finances-nope-00000000.db')).toThrow();
  });
});
