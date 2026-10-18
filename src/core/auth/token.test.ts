import { describe, expect, it } from 'vitest';

import {
  MIN_SECRET_LENGTH,
  SESSION_ISSUER,
  SessionTokenError,
  signSessionToken,
  verifySessionToken,
} from './token';

const SECRET = 's'.repeat(MIN_SECRET_LENGTH);
const OTHER_SECRET = 't'.repeat(MIN_SECRET_LENGTH);
const NOW = 1_700_000_000;

function sign(overrides: Partial<Parameters<typeof signSessionToken>[0]> = {}) {
  return signSessionToken({
    subject: 'user-1',
    role: 'admin',
    routerIds: ['router-a'],
    secret: SECRET,
    ttlSeconds: 3_600,
    now: NOW,
    tokenId: 'token-1',
    ...overrides,
  });
}

describe('signSessionToken', () => {
  it('emite los claims esperados', async () => {
    const { claims } = await sign();

    expect(claims).toEqual({
      sub: 'user-1',
      role: 'admin',
      routerIds: ['router-a'],
      iat: NOW,
      exp: NOW + 3_600,
      iss: SESSION_ISSUER,
      jti: 'token-1',
    });
  });

  it('produce un JWT de tres segmentos', async () => {
    const { token } = await sign();

    expect(token.split('.')).toHaveLength(3);
  });

  it('genera un jti distinto si no se indica', async () => {
    const first = await sign({ tokenId: undefined });
    const second = await sign({ tokenId: undefined });

    expect(first.claims.jti).not.toBe(second.claims.jti);
  });

  it('rechaza un secreto demasiado corto', async () => {
    await expect(sign({ secret: 'corto' })).rejects.toBeInstanceOf(SessionTokenError);
  });
});

describe('verifySessionToken', () => {
  it('acepta un token emitido con el mismo secreto', async () => {
    const { token, claims } = await sign();

    await expect(verifySessionToken(token, { secret: SECRET, now: NOW })).resolves.toEqual(claims);
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const { token } = await sign();

    await expect(verifySessionToken(token, { secret: OTHER_SECRET })).rejects.toMatchObject({
      reason: 'invalid',
    });
  });

  it('rechaza un token manipulado', async () => {
    const { token } = await sign();
    const [header, payload, signature] = token.split('.');
    const forged = `${header}.${payload}.${(signature ?? '').slice(0, -2)}xx`;

    await expect(verifySessionToken(forged, { secret: SECRET })).rejects.toBeInstanceOf(
      SessionTokenError,
    );
  });

  it('detecta la expiracion', async () => {
    const { token } = await sign({ ttlSeconds: 60 });

    await expect(
      verifySessionToken(token, { secret: SECRET, now: NOW + 3_600 }),
    ).rejects.toMatchObject({ reason: 'expired' });
  });

  it('rechaza otro emisor', async () => {
    const { token } = await sign({ issuer: 'otro-panel' });

    await expect(verifySessionToken(token, { secret: SECRET })).rejects.toMatchObject({
      reason: 'invalid',
    });
  });

  it('rechaza el token vacio', async () => {
    await expect(verifySessionToken('   ', { secret: SECRET })).rejects.toMatchObject({
      reason: 'malformed',
    });
  });

  it('rechaza un token con claims incompletos aunque la firma sea valida', async () => {
    // Firma un JWT sin `role` ni `routerIds` usando la misma clave.
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt(NOW)
      .setExpirationTime(NOW + 60)
      .setIssuer(SESSION_ISSUER)
      .setJti('token-1')
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifySessionToken(token, { secret: SECRET, now: NOW })).rejects.toMatchObject({
      reason: 'invalid',
    });
  });

  it('rechaza un rol desconocido', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ role: 'superuser', routerIds: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt(NOW)
      .setExpirationTime(NOW + 60)
      .setIssuer(SESSION_ISSUER)
      .setJti('token-1')
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifySessionToken(token, { secret: SECRET, now: NOW })).rejects.toMatchObject({
      reason: 'invalid',
    });
  });
});
