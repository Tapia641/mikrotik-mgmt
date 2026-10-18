import type { NextResponse } from 'next/server';

import type { ApiResponse, RouterSnapshot } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requireRouterAccess } from '@/app/api/_lib/session';
import { toDomainError } from '@/core/errors';
import { routerService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/routers/[id]/snapshot` — fotografia coherente del equipo
 * (identidad, recursos, interfaces, salud y sesiones hotspot activas).
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<NextResponse<ApiResponse<RouterSnapshot>>> {
  return handleRoute<RouterSnapshot>(async () => {
    const { id } = await context.params;
    await requireRouterAccess(id);

    const result = await routerService.getSnapshot(id);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}
