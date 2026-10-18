import { type NextResponse } from 'next/server';

import type { ApiResponse, HotspotHost } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requirePermission, requireRouterAccess } from '@/app/api/_lib/session';
import { invalidInput, toDomainError } from '@/core/errors';
import { hotspotService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse<ApiResponse<readonly HotspotHost[]>>> {
  return handleRoute<readonly HotspotHost[]>(async () => {
    await requirePermission('hotspot:read');

    const routerId = new URL(request.url).searchParams.get('routerId');
    if (routerId === null || routerId === '') {
      throw toDomainError(invalidInput('El router es obligatorio.', { field: 'routerId' }));
    }
    await requireRouterAccess(routerId);

    const result = await hotspotService.listHosts(routerId);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}