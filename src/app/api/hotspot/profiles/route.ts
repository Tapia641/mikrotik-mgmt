import { type NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiResponse, HotspotProfile } from '@/types';

import { handleRoute, readJson } from '@/app/api/_lib/http';
import { requirePermission, requireRouterAccess } from '@/app/api/_lib/session';
import { invalidInput, toDomainError } from '@/core/errors';
import { hotspotService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const profileInputSchema = z.object({
  routerId: z.string().uuid('Router invalido.'),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(64, 'Nombre demasiado largo.'),
  rateLimit: z.string().trim().max(64).nullable().optional(),
  sharedUsers: z.number().int().min(1).optional(),
  sessionTimeout: z.string().trim().max(32).nullable().optional(),
  idleTimeout: z.string().trim().max(32).nullable().optional(),
  addressPool: z.string().trim().max(64).nullable().optional(),
  onLogin: z.string().trim().max(255).nullable().optional(),
  onLogout: z.string().trim().max(255).nullable().optional(),
  disabled: z.boolean().optional(),
});

export async function GET(request: Request): Promise<NextResponse<ApiResponse<readonly HotspotProfile[]>>> {
  return handleRoute<readonly HotspotProfile[]>(async () => {
    await requirePermission('hotspot:read');

    const routerId = new URL(request.url).searchParams.get('routerId');
    if (routerId === null || routerId === '') {
      throw toDomainError(invalidInput('El router es obligatorio.', { field: 'routerId' }));
    }
    await requireRouterAccess(routerId);

    const result = await hotspotService.listProfiles(routerId);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}

export async function POST(request: Request): Promise<NextResponse<ApiResponse<HotspotProfile>>> {
  return handleRoute<HotspotProfile>(
    async () => {
      await requirePermission('hotspot:write');

      const input = await readJson(request, profileInputSchema);
      await requireRouterAccess(input.routerId);

      const result = await hotspotService.createProfile(input.routerId, {
        name: input.name,
        rateLimit: input.rateLimit ?? null,
        sharedUsers: input.sharedUsers,
        sessionTimeout: input.sessionTimeout ?? null,
        idleTimeout: input.idleTimeout ?? null,
        addressPool: input.addressPool ?? null,
        onLogin: input.onLogin ?? null,
        onLogout: input.onLogout ?? null,
        disabled: input.disabled,
      });
      if (!result.ok) throw toDomainError(result.error);

      return result.value;
    },
    { status: 201 },
  );
}