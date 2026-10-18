/**
 * Aplica las migraciones pendientes sobre la base configurada.
 *
 *   npm run db:migrate
 *
 * Es idempotente: volver a ejecutarlo no hace nada si todo esta al dia.
 */
import './load-env';

import { closeDb, getDb } from '@/database/db';
import { runMigrations } from '@/database/migrate';

const db = getDb();

try {
  const { applied, skipped } = runMigrations(db);

  if (applied.length === 0) {
    console.log(`Sin cambios: ${skipped.length} migracion(es) ya aplicadas.`);
  } else {
    console.log(`Aplicadas ${applied.length} migracion(es):`);
    for (const migration of applied) {
      console.log(`  + ${migration.id}_${migration.name}`);
    }
    if (skipped.length > 0) {
      console.log(`  (${skipped.length} ya estaban aplicadas)`);
    }
  }
} finally {
  closeDb();
}
