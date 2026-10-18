import type { NextResponse } from 'next/server';

import type { ApiResponse, InterfaceStat } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requireRouterAccess } from '@/app/api/_lib/session';
import { toDomainError } from '@/core/errors';
import { routerService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/routers/[id]/interfaces` — monitoreo de trafico por interfaz.
 *
 * El servicio toma DOS muestras de contadores separadas una ventana corta
 * (~1 s) y devuelve la tasa ya calculada en bits/s, de modo que la UI puede
 * limitarse a hacer polling sin reimplementar el calculo de deltas.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<NextResponse<ApiResponse<readonly InterfaceStat[]>>> {
  return handleRoute<readonly InterfaceStat[]>(async () => {
    const { id } = await context.params;
    await requireRouterAccess(id);

    const result = await routerService.listInterfaces(id);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}
