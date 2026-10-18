import { type NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiResponse, HotspotUser, Paginated } from '@/types';

import { handleRoute, readIntParam, readJson, readSortDirection } from '@/app/api/_lib/http';
import { requirePermission, requireRouterAccess } from '@/app/api/_lib/session';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/core/constants';
import { invalidInput, toDomainError } from '@/core/errors';
import type { HotspotUserStatus } from '@/types';
import { hotspotService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const userInputSchema = z.object({
  routerId: z.string().uuid('Router invalido.'),
  username: z.string().trim().min(1, 'El usuario es obligatorio.').max(64, 'Usuario demasiado largo.'),
  password: z.string().max(128, 'Contrasena demasiado larga.').nullable().optional(),
  profile: z.string().trim().min(1, 'El perfil es obligatorio.').max(64, 'Perfil demasiado largo.'),
  server: z.string().trim().max(64).nullable().optional(),
  limitUptime: z.string().trim().max(32).nullable().optional(),
  limitBytesIn: z.number().int().min(0).optional(),
  limitBytesOut: z.number().int().min(0).optional(),
  comment: z.string().trim().max(255).nullable().optional(),
  disabled: z.boolean().optional(),
});

const HOTSPOT_USER_STATUSES = [
  'unused',
  'active',
  'used',
  'expired',
  'disabled',
  'unknown',
] as const satisfies readonly HotspotUserStatus[];

function isHotspotUserStatus(value: string): value is HotspotUserStatus {
  return (HOTSPOT_USER_STATUSES as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<NextResponse<ApiResponse<Paginated<HotspotUser>>>> {
  return handleRoute<Paginated<HotspotUser>>(async () => {
    await requirePermission('hotspot:read');

    const query = new URL(request.url).searchParams;
    const routerId = query.get('routerId');
    if (routerId === null || routerId === '') {
      throw toDomainError(invalidInput('El router es obligatorio.', { field: 'routerId' }));
    }
    await requireRouterAccess(routerId);

    const status = query.get('status');
    const search = query.get('search')?.trim();
    const profile = query.get('profile')?.trim();
    const server = query.get('server')?.trim();
    const disabled = query.get('disabled');

    const result = await hotspotService.listUsers({
      routerId,
      page: readIntParam(query, 'page', 1, { min: 1, max: 10_000 }),
      pageSize: readIntParam(query, 'pageSize', DEFAULT_PAGE_SIZE, { min: 1, max: MAX_PAGE_SIZE }),
      sortBy: query.get('sortBy') ?? 'username',
      sortDirection: readSortDirection(query, 'asc'),
      ...(status !== null && isHotspotUserStatus(status) ? { status } : {}),
      ...(search !== undefined && search !== '' ? { search } : {}),
      ...(profile !== undefined && profile !== '' ? { profile } : {}),
      ...(server !== undefined && server !== '' ? { server } : {}),
      ...(disabled === null ? {} : { disabled: disabled === 'true' }),
    });

    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}

export async function POST(request: Request): Promise<NextResponse<ApiResponse<HotspotUser>>> {
  return handleRoute<HotspotUser>(
    async () => {
      await requirePermission('hotspot:write');

      const input = await readJson(request, userInputSchema);
      await requireRouterAccess(input.routerId);

      const result = await hotspotService.createUser(input);
      if (!result.ok) throw toDomainError(result.error);

      return result.value;
    },
    { status: 201 },
  );
}