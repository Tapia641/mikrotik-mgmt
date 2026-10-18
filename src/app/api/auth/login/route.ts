import type { NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiResponse, LoginPayload } from '@/types';

import { handleRoute, readJson } from '@/app/api/_lib/http';
import { applySessionCookie } from '@/app/api/_lib/session';
import { rateLimited, toDomainError } from '@/core/errors';
import { authService, type LoginContext } from '@/core/services';
import { loginRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const credentialsSchema = z.object({
  username: z.string().trim().min(1, 'El usuario es obligatorio.').max(64, 'Usuario demasiado largo.'),
  password: z.string().min(1, 'La contrasena es obligatoria.').max(128, 'Contrasena demasiado larga.'),
});

/** Contexto de auditoria: IP real detras del proxy y user-agent. */
function loginContextFrom(request: Request): LoginContext {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim();
  const userAgent = request.headers.get('user-agent');

  return {
    ...(ip !== undefined && ip !== '' ? { ip } : {}),
    ...(userAgent !== null && userAgent !== '' ? { userAgent } : {}),
  };
}

/**
 * `POST /api/auth/login` — 200 con `{ user, session }`.
 *
 * El JWT NO se devuelve en el cuerpo: se deposita en una cookie httpOnly, para
 * que el JavaScript del panel no pueda leerlo.
 */
export async function POST(request: Request): Promise<NextResponse<ApiResponse<LoginPayload>>> {
  let issuedToken: string | null = null;

  return handleRoute<LoginPayload>(
    async () => {
      const forwarded = request.headers.get('x-forwarded-for');
      const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';

      if (!loginRateLimiter.check(ip)) {
        throw toDomainError(rateLimited());
      }

      const credentials = await readJson(request, credentialsSchema);
      const result = await authService.login(credentials, loginContextFrom(request));

      if (!result.ok) throw toDomainError(result.error);

      const { user, session, token } = result.value;
      issuedToken = token;

      return { user, session };
    },
    {
      onResponse: (response) => {
        if (issuedToken !== null) applySessionCookie(response, issuedToken);
      },
    },
  );
}
