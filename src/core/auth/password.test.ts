import { describe, expect, it } from 'vitest';

import { BCRYPT_MAX_BYTES, PasswordError, hashPassword, needsRehash, verifyPassword } from './password';

/** Coste minimo de bcrypt: los tests no necesitan 12 rondas. */
const ROUNDS = 4;

describe('hashPassword', () => {
  it('devuelve un hash verificable con el coste pedido', async () => {
    const hash = await hashPassword('s3cret-password', ROUNDS);

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    await expect(verifyPassword('s3cret-password', hash)).resolves.toBe(true);
  });

  it('genera hashes distintos para la misma contrasena (salt aleatorio)', async () => {
    const first = await hashPassword('misma-contrasena', ROUNDS);
    const second = await hashPassword('misma-contrasena', ROUNDS);

    expect(first).not.toBe(second);
  });

  it('rechaza la contrasena vacia', async () => {
    await expect(hashPassword('', ROUNDS)).rejects.toBeInstanceOf(PasswordError);
  });

  it('rechaza contrasenas por encima del limite de bcrypt', async () => {
    const long = 'a'.repeat(BCRYPT_MAX_BYTES + 1);

    await expect(hashPassword(long, ROUNDS)).rejects.toBeInstanceOf(PasswordError);
  });

  it('rechaza un coste fuera de rango', async () => {
    await expect(hashPassword('x', 3)).rejects.toBeInstanceOf(PasswordError);
    await expect(hashPassword('x', 16)).rejects.toBeInstanceOf(PasswordError);
    await expect(hashPassword('x', 4.5)).rejects.toBeInstanceOf(PasswordError);
  });
});

describe('verifyPassword', () => {
  it('devuelve false con una contrasena incorrecta', async () => {
    const hash = await hashPassword('correcta', ROUNDS);

    await expect(verifyPassword('incorrecta', hash)).resolves.toBe(false);
  });

  it('no lanza ante un hash corrupto', async () => {
    await expect(verifyPassword('x', 'no-es-un-hash')).resolves.toBe(false);
  });

  it('no lanza ante entradas vacias', async () => {
    await expect(verifyPassword('', '')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });
});

describe('needsRehash', () => {
  it('es false cuando el coste coincide', async () => {
    const hash = await hashPassword('x', ROUNDS);

    expect(needsRehash(hash, ROUNDS)).toBe(false);
  });

  it('es true cuando el coste configurado cambio', async () => {
    const hash = await hashPassword('x', ROUNDS);

    expect(needsRehash(hash, 5)).toBe(true);
  });

  it('es true ante un hash ilegible', () => {
    expect(needsRehash('basura', ROUNDS)).toBe(true);
  });
});
