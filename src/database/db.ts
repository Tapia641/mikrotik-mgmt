import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import Database from 'better-sqlite3';

/**
 * Conexion SQLite (better-sqlite3, driver SINCRONO).
 *
 * Decision de arquitectura: al ser sincrono, los repositorios exponen metodos
 * sincronos (`findById(): T | null`) y la asincronia se concentra en los
 * servicios, que ademas esperan a RouterOS. Ver ARCHITECTURE.md §4.
 *
 * `getDb()` cachea el handle en `globalThis` para sobrevivir al HMR de Next en
 * dev (evita abrir N conexiones y multiplicar los locks WAL).
 *
 * IMPORTANTE: `getDb()` NO migra. Las migraciones se aplican de forma explicita
 * (`npm run db:migrate`) o desde los tests (`createTestDb()`).
 */
export type Db = Database.Database;

export const IN_MEMORY_DB = ':memory:';

const DEFAULT_DB_FILE = resolve(process.cwd(), 'data', 'mikrotik-manager.sqlite');

declare global {
  var __mwmDatabase__: Db | undefined;
}

/** `:memory:`, `file::memory:` y URIs con `mode=memory` no tocan el disco. */
function isMemoryDatabase(file: string): boolean {
  return file === IN_MEMORY_DB || file.startsWith('file::memory:') || file.includes('mode=memory');
}

function resolveDatabaseFile(): string {
  const configured = process.env.DATABASE_FILE?.trim();
  if (!configured) return DEFAULT_DB_FILE;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

/**
 * Abre una conexion nueva y aplica los PRAGMA base.
 * Pensado para composicion explicita (tests, scripts, futuro pool).
 */
export function createDb(file: string): Db {
  const memory = isMemoryDatabase(file);

  if (!memory) {
    const directory = dirname(resolve(file));
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  }

  const db = new Database(file);

  if (!memory) {
    // WAL: lecturas concurrentes durante escrituras (panel multi-pestana).
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

/** Abre (o reutiliza) la conexion de la aplicacion. Idempotente. */
export function getDb(): Db {
  const cached = globalThis.__mwmDatabase__;
  if (cached) return cached;

  const db = createDb(resolveDatabaseFile());
  globalThis.__mwmDatabase__ = db;
  return db;
}

/** Cierra la conexion de la aplicacion (tests y shutdown). Idempotente. */
export function closeDb(): void {
  const db = globalThis.__mwmDatabase__;
  if (!db) return;
  db.close();
  globalThis.__mwmDatabase__ = undefined;
}

export default getDb;
