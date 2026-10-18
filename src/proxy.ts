import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, verifySessionToken } from '@/core/auth/token';
import { env } from '@/lib/env';

/**
 * Proxy (antes `middleware`): en Next 16 el fichero se llama `proxy.ts` y la
 * funcionalidad es la misma.
 *
 * Hace SOLO comprobaciones optimistas:
 *   · sin cookie o con firma invalida → redirige a `/login?next=...`
 *   · ya autenticado en `/login`      → redirige a `/dashboard`
 *
 * Deliberadamente NO consulta SQLite (el proxy corre antes del render, en el
 * runtime Edge) y NO es la frontera de seguridad: los Route Handlers exigen
 * sesion con `requireSession()` / `requirePermission()` y el servicio vuelve a
 * validar el usuario contra la base de datos.
 */

const LOGIN_PATH = '/login';
const DASHBOARD_PATH = '/dashboard';

const PROTECTED_PREFIXES: readonly string[] = ['/dashboard', '/hotspot'];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

async function hasValidSignature(token: string): Promise<boolean> {
  try {
    await verifySessionToken(token, { secret: env.SESSION_SECRET });
    return true;
  } catch {
    // Cookie manipulada, vencida o firmada con otro secreto.
    return false;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = token !== undefined && token !== '' && (await hasValidSignature(token));

  if (pathname === LOGIN_PATH && authenticated) {
    return NextResponse.redirect(new URL(DASHBOARD_PATH, request.url));
  }

  if (isProtected(pathname) && !authenticated) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/hotspot/:path*', '/login'],
};
