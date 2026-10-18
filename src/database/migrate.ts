import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Db } from './db';

/**
 * Runner de migraciones SQL.
 *
 * Modelo: cada archivo `NNNN_nombre.sql` de `src/database/migrations/` se aplica
 * UNA vez, en orden lexicografico, dentro de una transaccion, y se registra en la
 * tabla `_migrations` con su checksum SHA-256.
 *
 * Garantias:
 *  - Idempotencia: volver a ejecutar no re-aplica nada.
 *  - Atomicidad: si el SQL falla, la transaccion revierte y NO queda registrada.
 *  - Inmutabilidad: si un archivo ya aplicado cambia, se lanza `MigrationError`.
 *  - Orden: no se permite insertar una migracion con id menor a la ultima aplicada.
 *
 * Esta capa es *infraestructura*: no conoce el dominio ni RouterOS.
 */

export const MIGRATIONS_DIR = resolve(process.cwd(), 'src', 'database', 'migrations');

/** `0001_init.sql` -> id `0001`, nombre `init`. */
const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/i;

const MIGRATIONS_TABLE = '_migrations';

export interface MigrationFile {
  readonly id: string;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly id: string;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  /** Migraciones aplicadas en esta ejecucion. */
  readonly applied: readonly AppliedMigration[];
  /** Migraciones ya presentes en `_migrations` (no se tocan). */
  readonly skipped: readonly string[];
}

export class MigrationError extends Error {
  public override readonly name = 'MigrationError';
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Lee y ordena las migraciones del directorio. Ignora archivos que no cumplen el patron. */
export function loadMigrations(directory: string = MIGRATIONS_DIR): MigrationFile[] {
  if (!existsSync(directory)) return [];

  const migrations: MigrationFile[] = [];

  for (const filename of readdirSync(directory).sort((a, b) => a.localeCompare(b))) {
    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) continue;

    const id = match[1];
    const name = match[2];
    if (id === undefined || name === undefined) continue;

    const sql = readFileSync(join(directory, filename), 'utf8');
    migrations.push({ id, name, filename, sql, checksum: sha256(sql) });
  }

  return migrations;
}

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function getAppliedMigrations(db: Db): AppliedMigration[] {
  ensureMigrationsTable(db);

  const rows = db
    .prepare<[], { id: string; name: string; checksum: string; applied_at: string }>(
      `SELECT id, name, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id ASC`,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}

export interface RunMigrationsOptions {
  readonly directory?: string;
  readonly appliedAt?: string;
}

/**
 * Aplica las migraciones pendientes. Devuelve que se aplico y que se omitio.
 * Lanza `MigrationError` si detecta checksums alterados o migraciones fuera de orden.
 */
export function runMigrations(db: Db, options: RunMigrationsOptions = {}): MigrationResult {
  const appliedAt = options.appliedAt ?? new Date().toISOString();
  const migrations = loadMigrations(options.directory);
  const alreadyApplied = new Map(getAppliedMigrations(db).map((m) => [m.id, m]));

  // 1. Inmutabilidad: una migracion aplicada no puede cambiar.
  for (const migration of migrations) {
    const previous = alreadyApplied.get(migration.id);
    if (previous && previous.checksum !== migration.checksum) {
      throw new MigrationError(
        `La migracion ${migration.filename} cambio despues de aplicarse ` +
          `(checksum ${previous.checksum.slice(0, 12)} -> ${migration.checksum.slice(0, 12)}). ` +
          'Crea una migracion nueva en lugar de editar una aplicada.',
      );
    }
  }

  // 2. Orden: no se admite una migracion pendiente anterior a la ultima aplicada.
  const lastApplied = [...alreadyApplied.keys()].sort((a, b) => a.localeCompare(b)).at(-1);
  if (lastApplied !== undefined) {
    const outOfOrder = migrations.find((m) => !alreadyApplied.has(m.id) && m.id < lastApplied);
    if (outOfOrder) {
      throw new MigrationError(
        `La migracion pendiente ${outOfOrder.filename} es anterior a la ultima aplicada ` +
          `(${lastApplied}). Renombrala con un id mayor.`,
      );
    }
  }

  // 3. Aplicacion atomica de cada pendiente.
  const applyOne = db.transaction((migration: MigrationFile) => {
    db.exec(migration.sql);
    db.prepare(
      `INSERT INTO ${MIGRATIONS_TABLE} (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
    ).run(migration.id, migration.name, migration.checksum, appliedAt);
  });

  const applied: AppliedMigration[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }

    applyOne(migration);
    applied.push({
      id: migration.id,
      name: migration.name,
      checksum: migration.checksum,
      appliedAt,
    });
  }

  return { applied, skipped };
}
