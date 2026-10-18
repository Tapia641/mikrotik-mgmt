/**
 * Inserta datos de desarrollo (owner + router de ejemplo + paquetes).
 *
 *   npm run db:seed
 *
 * Idempotente. Requiere `ENCRYPTION_KEY` para cifrar la contrasena del router:
 * si falta, falla con un mensaje que indica como generarla.
 */
import './load-env';

import { closeDb, getDb } from '@/database/db';
import { seed } from '@/database/seed';
import { isDomainError } from '@/core/errors';

const db = getDb();

try {
  const { created, skipped } = seed(db);

  console.log(
    created.length === 0
      ? 'Nada que crear: el seed ya estaba aplicado.'
      : `Creado: ${created.join(', ')}`,
  );

  if (skipped.length > 0) {
    console.log(`Omitido (ya existia): ${skipped.join(', ')}`);
  }
} catch (error) {
  if (isDomainError(error)) {
    console.error(`${error.code}: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
} finally {
  closeDb();
}
