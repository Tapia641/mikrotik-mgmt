import { type NextResponse } from 'next/server';

import type { ApiResponse, HotspotActiveSession } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requirePermission, requireRouterAccess } from '@/app/api/_lib/session';
import { invalidInput, toDomainError } from '@/core/errors';
import { hotspotService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse<ApiResponse<readonly HotspotActiveSession[]>>> {
  return handleRoute<readonly HotspotActiveSession[]>(async () => {
    await requirePermission('hotspot:read');

    const routerId = new URL(request.url).searchParams.get('routerId');
    if (routerId === null || routerId === '') {
      throw toDomainError(invalidInput('El router es obligatorio.', { field: 'routerId' }));
    }
    await requireRouterAccess(routerId);

    const result = await hotspotService.listActiveSessions(routerId);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}