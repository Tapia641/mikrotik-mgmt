import { SignJWT, errors, jwtVerify } from 'jose';

import type { SessionClaims, UserRole } from '@/types';

import { USER_ROLES } from '@/core/constants';

/**
 * Firma y verificacion del token de sesion (JWT HS256 con `jose`).
 *
 * El token es SIN ESTADO: lleva `sub`, `role`, `routerIds`, `iat`, `exp`, `iss`
 * y `jti`. La revocacion anticipada (logout) se resuelve con la lista de
 * revocacion por `jti` (`core/auth/denylist.ts`).
 *
 * `jose` funciona igual en Node y en el runtime Edge, por eso `proxy.ts` puede
 * verificar la firma sin tocar SQLite.
 */

export const SESSION_ISSUER = 'mikrotik-web-manager';
export const SESSION_ALGORITHM = 'HS256';

/** Nombre de la cookie httpOnly que transporta el token de sesion. */
export const SESSION_COOKIE_NAME = 'mt_session';

/** Longitud minima del secreto de firma (HS256). */
export const MIN_SECRET_LENGTH = 32;

export type SessionTokenFailure = 'malformed' | 'expired' | 'invalid';

export class SessionTokenError extends Error {
  public override readonly name = 'SessionTokenError';

  public readonly reason: SessionTokenFailure;

  public constructor(reason: SessionTokenFailure, message: string, cause?: unknown) {
    super(message, { cause });
    this.reason = reason;
  }
}

export interface SignSessionTokenInput {
  readonly subject: string;
  readonly role: UserRole;
  readonly routerIds: readonly string[];
  readonly secret: string;
  readonly ttlSeconds: number;
  readonly issuer?: string;
  readonly tokenId?: string;
  /** Epoch en segundos; inyectable para tests deterministas. */
  readonly now?: number;
}

export interface SignedSessionToken {
  readonly token: string;
  readonly claims: SessionClaims;
}

export interface VerifySessionTokenOptions {
  readonly secret: string;
  readonly issuer?: string;
  /** Epoch en segundos; inyectable para tests deterministas. */
  readonly now?: number;
}

function secretKey(secret: string): Uint8Array {
  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new SessionTokenError(
      'invalid',
      `El secreto de sesion debe tener al menos ${MIN_SECRET_LENGTH} caracteres.`,
    );
  }

  return new TextEncoder().encode(secret);
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Valida la forma de los claims: un token bien firmado con basura dentro no vale. */
function toClaims(payload: Readonly<Record<string, unknown>>): SessionClaims {
  const { sub, role, routerIds, iat, exp, iss, jti } = payload;

  if (
    typeof sub !== 'string' ||
    !isUserRole(role) ||
    !isStringArray(routerIds) ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    typeof iss !== 'string' ||
    typeof jti !== 'string'
  ) {
    throw new SessionTokenError('invalid', 'Los claims del token de sesion no son validos.');
  }

  return { sub, role, routerIds, iat, exp, iss, jti };
}

function translateJoseError(cause: unknown): SessionTokenError {
  if (cause instanceof SessionTokenError) return cause;

  if (cause instanceof errors.JWTExpired) {
    return new SessionTokenError('expired', 'La sesion expiro. Inicia sesion de nuevo.', cause);
  }

  if (cause instanceof errors.JOSEError) {
    return new SessionTokenError('invalid', 'Token de sesion invalido.', cause);
  }

  return new SessionTokenError('malformed', 'No se pudo verificar el token de sesion.', cause);
}

export async function signSessionToken(input: SignSessionTokenInput): Promise<SignedSessionToken> {
  const key = secretKey(input.secret);
  const issuer = input.issuer ?? SESSION_ISSUER;
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000);

  const claims: SessionClaims = {
    sub: input.subject,
    role: input.role,
    routerIds: [...input.routerIds],
    iat: issuedAt,
    exp: issuedAt + Math.max(1, Math.trunc(input.ttlSeconds)),
    iss: issuer,
    jti: input.tokenId ?? globalThis.crypto.randomUUID(),
  };

  const token = await new SignJWT({ role: claims.role, routerIds: [...claims.routerIds] })
    .setProtectedHeader({ alg: SESSION_ALGORITHM, typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .setIssuer(claims.iss)
    .setJti(claims.jti)
    .sign(key);

  return { token, claims };
}

export async function verifySessionToken(
  token: string,
  options: VerifySessionTokenOptions,
): Promise<SessionClaims> {
  if (token.trim().length === 0) {
    throw new SessionTokenError('malformed', 'No hay token de sesion.');
  }

  let payload: Record<string, unknown>;

  try {
    const verified = await jwtVerify(token, secretKey(options.secret), {
      issuer: options.issuer ?? SESSION_ISSUER,
      algorithms: [SESSION_ALGORITHM],
      ...(options.now === undefined ? {} : { currentDate: new Date(options.now * 1000) }),
    });

    payload = verified.payload as Record<string, unknown>;
  } catch (cause) {
    throw translateJoseError(cause);
  }

  return toClaims(payload);
}
