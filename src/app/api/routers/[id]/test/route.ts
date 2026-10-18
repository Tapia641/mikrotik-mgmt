import type { NextResponse } from 'next/server';

import type { ApiResponse } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requireRouterAccess } from '@/app/api/_lib/session';
import { toDomainError } from '@/core/errors';
import { routerService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/routers/[id]/test` — abre una conexion real al equipo y persiste
 * el resultado (`status`, `lastSeenAt`, `lastError`).
 *
 * Un router inalcanzable NO es un 500: `MikrotikError` se traduce a 502 (o 504
 * si fue timeout) con `details.mikrotikCode`, y el cuerpo explica el fallo.
 * Por eso esta llamada no lo captura: el borde HTTP ya sabe representarlo.
 */
export async function POST(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<NextResponse<ApiResponse<{ readonly latencyMs: number }>>> {
  return handleRoute<{ readonly latencyMs: number }>(async () => {
    const { id } = await context.params;
    await requireRouterAccess(id);

    const result = await routerService.testConnection(id);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}
