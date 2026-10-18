import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

/**
 * Carga los ficheros de entorno para los scripts de linea de comandos.
 *
 * `next dev|build|start` carga `.env.local`/`.env` por su cuenta, pero
 * `tsx scripts/*.ts` no: sin esto, `npm run db:seed` no veria `ENCRYPTION_KEY`
 * ni `SESSION_SECRET` y fallaria pese a estar configurados.
 *
 * Se importa por EFECTO SECUNDARIO como primera sentencia de cada script
 * (`import './load-env';`): el orden de evaluacion de ESM garantiza que
 * `src/lib/env.ts` lea `process.env` ya poblado.
 *
 * Precedencia: `.env.local` gana sobre `.env` (primero en cargarse) y las
 * variables ya presentes en el entorno nunca se sobrescriben.
 */

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile(file);
}
