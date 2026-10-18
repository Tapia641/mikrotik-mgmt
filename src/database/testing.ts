import { DomainError } from '@/core/errors';

import { createDb, type Db } from './db';
import { runMigrations } from './migrate';

/**
 * Base de datos en memoria con el esquema migrado, para tests.
 *
 * Cada llamada devuelve una conexion INDEPENDIENTE (`:memory:`), de modo que
 * los tests no comparten estado ni tocan `data/*.sqlite`. Se inyecta en los
 * repositorios: `new RouterRepository(createTestDb())`.
 */
export function createTestDb(): Db {
  const db = createDb(':memory:');
  runMigrations(db);
  return db;
}

/** Ejecuta `fn` esperando un `DomainError`; falla si no se lanza o es de otro tipo. */
export function catchDomainError(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }

  throw new Error('Se esperaba un DomainError, pero no se lanzo ningun error.');
}

