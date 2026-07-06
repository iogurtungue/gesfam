import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..');

/**
 * Where the SQLite file and its backups live. Overridable via env vars so
 * tests can point at ':memory:' or a throwaway temp file instead of the
 * real data — never hardcode a path when calling getDb() in tests.
 */
export const DADES_DIR = process.env.GESFAM_DADES_DIR ?? path.join(REPO_ROOT, 'dades');
export const DB_PATH = process.env.GESFAM_DB_PATH ?? path.join(DADES_DIR, 'finances.db');

function migrationsDir(): string {
  return path.join(here, 'migrations');
}

function runMigrations(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const files = fs
    .readdirSync(migrationsDir())
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir(), file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`La migració ${file} ha fallat: ${(err as Error).message}`);
    }
  }
}

let instance: DatabaseSync | null = null;

/**
 * Opens (once per process) the SQLite database at DB_PATH, applying any
 * pending migrations from db/migrations/ in filename order. Safe to call
 * repeatedly — subsequent calls return the same open connection.
 */
export function getDb(): DatabaseSync {
  if (instance) return instance;
  if (DB_PATH !== ':memory:') {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  instance = new DatabaseSync(DB_PATH);
  if (DB_PATH !== ':memory:') {
    instance.exec('PRAGMA journal_mode = WAL');
  }
  runMigrations(instance);
  return instance;
}

/** For tests: drop the cached connection so the next getDb() reopens fresh (e.g. after switching GESFAM_DB_PATH). */
export function closeDb(): void {
  instance?.close();
  instance = null;
}
