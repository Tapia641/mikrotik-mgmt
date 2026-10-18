import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDb, type Db } from './db';
import {
  getAppliedMigrations,
  loadMigrations,
  MigrationError,
  runMigrations,
  sha256,
} from './migrate';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mwm-migrations-'));
  tempDirs.push(dir);
  return dir;
}

function tableNames(db: Db): string[] {
  return db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadMigrations', () => {
  it('descubre solo los archivos NNNN_nombre.sql, ordenados por id', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '0002_second.sql'), 'SELECT 2;');
    writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;');
    writeFileSync(join(dir, 'notas.txt'), 'ignorado');
    writeFileSync(join(dir, 'sin_prefijo.sql'), 'ignorado');

    const migrations = loadMigrations(dir);

    expect(migrations.map((migration) => migration.id)).toEqual(['0001', '0002']);
    expect(migrations.map((migration) => migration.name)).toEqual(['first', 'second']);
  });

  it('devuelve un array vacio si el directorio no existe', () => {
    expect(loadMigrations(join(tmpdir(), 'mwm-no-existe-12345'))).toEqual([]);
  });

  it('calcula un checksum SHA-256 estable sobre el contenido', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '0001_a.sql'), 'SELECT 1;');

    const [migration] = loadMigrations(dir);

    expect(migration?.checksum).toBe(sha256('SELECT 1;'));
    expect(migration?.checksum).toHaveLength(64);
  });
});

describe('runMigrations', () => {
  it('aplica el esquema inicial y lo registra en _migrations', () => {
    const db = createDb(':memory:');

    const result = runMigrations(db);

    expect(result.applied.map((migration) => migration.id)).toEqual(['0001']);
    expect(result.skipped).toEqual([]);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        '_migrations',
        'audit_log',
        'reseller_profiles',
        'routers',
        'transactions',
        'users',
        'voucher_batches',
        'vouchers',
      ]),
    );
    expect(getAppliedMigrations(db)).toHaveLength(1);
  });

  it('es idempotente: la segunda ejecucion no aplica nada', () => {
    const db = createDb(':memory:');
    runMigrations(db);

    const second = runMigrations(db);

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001']);
  });

  it('revierte la migracion completa si el SQL falla (no queda registrada)', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, '0001_broken.sql'),
      'CREATE TABLE parcial (id TEXT);\nCREATE TABLE rota (;',
    );

    const db = createDb(':memory:');

    expect(() => runMigrations(db, { directory: dir })).toThrow();

    expect(getAppliedMigrations(db)).toEqual([]);
    expect(tableNames(db)).not.toContain('parcial');
  });

  it('detecta una migracion ya aplicada cuyo contenido cambio', () => {
    const dir = makeTempDir();
    const file = join(dir, '0001_init.sql');
    writeFileSync(file, 'CREATE TABLE primera (id TEXT);');

    const db = createDb(':memory:');
    runMigrations(db, { directory: dir });

    writeFileSync(file, 'CREATE TABLE primera (id TEXT, extra TEXT);');

    expect(() => runMigrations(db, { directory: dir })).toThrow(MigrationError);
    expect(() => runMigrations(db, { directory: dir })).toThrow(/checksum/i);
  });

  it('rechaza una migracion pendiente anterior a la ultima aplicada', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE b (id TEXT);');

    const db = createDb(':memory:');
    runMigrations(db, { directory: dir });

    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (id TEXT);');

    expect(() => runMigrations(db, { directory: dir })).toThrow(MigrationError);
    expect(() => runMigrations(db, { directory: dir })).toThrow(/anterior/i);
  });

  it('aplica varias migraciones pendientes en orden', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (id TEXT);');
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE b (id TEXT);');

    const db = createDb(':memory:');
    const result = runMigrations(db, { directory: dir, appliedAt: '2026-01-01T00:00:00.000Z' });

    expect(result.applied.map((migration) => migration.id)).toEqual(['0001', '0002']);
    expect(tableNames(db)).toEqual(expect.arrayContaining(['a', 'b', '_migrations']));
    expect(getAppliedMigrations(db)[0]?.appliedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
