import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import type { Permission, SessionUser } from '@/types';

import { forbidden, toDomainError, unauthorized } from '@/core/errors';
import { canAccessRouter, can } from '@/core/auth/authz';
import { SESSION_COOKIE_NAME } from '@/core/auth/token';
import { authService } from '@/core/services';
import { env } from '@/lib/env';

/**
 * Sesion del panel en el borde HTTP: cookie httpOnly + resolucion del usuario.
 *
 * El proxy (`src/proxy.ts`) solo hace una comprobacion optimista de la FIRMA
 * para redirigir a `/login`. La autorizacion real vive aqui y en los servicios:
 * un proxy no es una frontera de seguridad (ver docs de Next 16 → Proxy).
 */

export { SESSION_COOKIE_NAME };

/** `secure` se activa en produccion (en local no hay HTTPS). */
export function isSecureContext(): boolean {
  return env.NODE_ENV === 'production';
}

export interface SessionCookieShape {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly secure: boolean;
  readonly maxAge: number;
}

export function sessionCookie(token: string, ttlSeconds: number = env.SESSION_TTL_SECONDS): SessionCookieShape {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isSecureContext(),
    maxAge: Math.max(1, Math.trunc(ttlSeconds)),
  };
}

export function clearedSessionCookie(): SessionCookieShape {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isSecureContext(),
    maxAge: 0,
  };
}

export function applySessionCookie<T>(response: NextResponse<T>, token: string, ttlSeconds?: number): void {
  response.cookies.set(sessionCookie(token, ttlSeconds));
}

export function applyClearedSessionCookie<T>(response: NextResponse<T>): void {
  response.cookies.set(clearedSessionCookie());
}

/** Token crudo de la cookie (o `null`). */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;

  return value === undefined || value === '' ? null : value;
}

/** Exige una sesion valida; lanza `DomainError UNAUTHORIZED` si no la hay. */
export async function requireSession(): Promise<SessionUser> {
  const token = await readSessionToken();
  if (token === null) throw unauthorized('Necesitas iniciar sesion.');

  const result = await authService.resolveSession(token);
  if (!result.ok) throw toDomainError(result.error);

  return result.value;
}

/** Exige un permiso concreto segun el rol del usuario. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireSession();

  if (!can(user.role, permission)) {
    throw forbidden(`Tu rol (${user.role}) no permite "${permission}".`);
  }

  return user;
}

/** Exige acceso al router indicado (rol + alcance `routerIds`). */
export async function requireRouterAccess(routerId: string): Promise<SessionUser> {
  const user = await requireSession();

  if (!canAccessRouter(user, routerId)) {
    throw forbidden('No tienes acceso a ese router.');
  }

  return user;
}
