import { type NextResponse } from 'next/server';

import type { ApiResponse } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requirePermission, requireRouterAccess } from '@/app/api/_lib/session';
import { invalidInput, toDomainError } from '@/core/errors';
import { hotspotService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<void>>> {
  return handleRoute<void>(async () => {
    await requirePermission('hotspot:write');

    const { id } = await context.params;
    const routerId = new URL(request.url).searchParams.get('routerId');
    if (routerId === null || routerId === '') {
      throw toDomainError(invalidInput('El router es obligatorio.', { field: 'routerId' }));
    }
    await requireRouterAccess(routerId);

    const result = await hotspotService.removeProfile(routerId, id);
    if (!result.ok) throw toDomainError(result.error);
  });
}