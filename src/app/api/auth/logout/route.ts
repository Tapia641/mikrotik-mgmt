import type { NextResponse } from 'next/server';

import type { ApiResponse } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { applyClearedSessionCookie, readSessionToken } from '@/app/api/_lib/session';
import { toDomainError } from '@/core/errors';
import { authService } from '@/core/services';

export const runtime = 'nodejs';

/**
 * `POST /api/auth/logout` — 200 siempre.
 *
 * Revoca el `jti` del token (lista de revocacion) y borra la cookie. Es
 * idempotente: cerrar sesion dos veces, o con una cookie ya vencida, no falla.
 */
export async function POST(): Promise<NextResponse<ApiResponse<null>>> {
  return handleRoute<null>(
    async () => {
      const token = await readSessionToken();

      if (token !== null) {
        const result = await authService.logout(token);
        if (!result.ok) throw toDomainError(result.error);
      }

      return null;
    },
    { onResponse: applyClearedSessionCookie },
  );
}
