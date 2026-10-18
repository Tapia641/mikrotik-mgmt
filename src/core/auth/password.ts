import { compare, getRounds, hash } from 'bcryptjs';

/**
 * Primitivas de contrasena del panel (bcrypt via `bcryptjs`).
 *
 * `bcryptjs` es JavaScript puro: las variantes asincronas trocean el trabajo con
 * `setImmediate`, asi que NO bloquean el event loop como las `*Sync`. Aqui solo
 * se usan las asincronas.
 *
 * El coste (`rounds`) es politica de la aplicacion y lo decide el llamador
 * (`BCRYPT_ROUNDS` en `core/constants`).
 */

/** Limite duro de bcrypt: por encima de 72 bytes la contrasena se trunca. */
export const BCRYPT_MAX_BYTES = 72;

const MIN_ROUNDS = 4;
const MAX_ROUNDS = 15;

export class PasswordError extends Error {
  public override readonly name = 'PasswordError';
}

/** Deriva el hash de una contrasena. Lanza `PasswordError` si la entrada no es usable. */
export async function hashPassword(plain: string, rounds: number): Promise<string> {
  if (plain.length === 0) {
    throw new PasswordError('La contrasena no puede estar vacia.');
  }

  if (Buffer.byteLength(plain, 'utf8') > BCRYPT_MAX_BYTES) {
    throw new PasswordError(
      `La contrasena supera el limite de ${BCRYPT_MAX_BYTES} bytes de bcrypt.`,
    );
  }

  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new PasswordError(`El coste de bcrypt debe estar entre ${MIN_ROUNDS} y ${MAX_ROUNDS}.`);
  }

  return hash(plain, rounds);
}

/**
 * Compara una contrasena con su hash. Nunca lanza: un hash corrupto o vacio se
 * trata como "no coincide" para que el login no revele detalles.
 */
export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  if (plain.length === 0 || passwordHash.length === 0) return false;

  try {
    return await compare(plain, passwordHash);
  } catch {
    return false;
  }
}

/** `true` si el hash se genero con otro coste (conviene rehashear al entrar). */
export function needsRehash(passwordHash: string, rounds: number): boolean {
  try {
    return getRounds(passwordHash) !== rounds;
  } catch {
    return true;
  }
}
