import type { NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiResponse, Paginated, PublicRouter, RouterStatus } from '@/types';

import { handleRoute, readIntParam, readJson, readSortDirection } from '@/app/api/_lib/http';
import { requirePermission } from '@/app/api/_lib/session';
import { auditRepository } from '@/database/repositories';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/core/constants';
import { toDomainError } from '@/core/errors';
import { routerService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/routers` (listado) y `POST /api/routers` (alta).
 *
 * El esquema del borde es la PRIMERA validacion: la del servicio es la segunda
 * (defensa en profundidad, porque tambien se le puede llamar sin pasar por HTTP).
 * `password` entra en claro SOLO aqui; a partir de esta capa ya va cifrada.
 */

const ROUTER_STATUSES = [
  'unknown',
  'connecting',
  'online',
  'offline',
  'unauthorized',
] as const satisfies readonly RouterStatus[];

function isRouterStatus(value: string): value is RouterStatus {
  return (ROUTER_STATUSES as readonly string[]).includes(value);
}

const routerInputSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(64, 'Nombre demasiado largo.'),
  description: z.string().trim().max(255, 'Descripcion demasiado larga.').nullable().optional(),
  host: z
    .string()
    .trim()
    .min(1, 'El host es obligatorio.')
    .max(255, 'Host demasiado largo.')
    .refine((value) => !/\s/.test(value), 'El host no puede contener espacios.'),
  port: z
    .number()
    .int('El puerto debe ser entero.')
    .min(1, 'Puerto fuera de rango.')
    .max(65_535, 'Puerto fuera de rango.'),
  protocol: z.enum(['api', 'api-ssl']),
  username: z.string().trim().min(1, 'El usuario es obligatorio.').max(64, 'Usuario demasiado largo.'),
  password: z.string().min(1, 'La contrasena es obligatoria.').max(128, 'Contrasena demasiado larga.'),
  tlsInsecure: z.boolean().optional(),
  timeoutMs: z.number().int().min(500, 'Timeout minimo 500 ms.').max(60_000, 'Timeout maximo 60000 ms.').optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().length(3, 'La moneda debe tener 3 letras.').optional(),
  isActive: z.boolean().optional(),
});

export async function GET(request: Request): Promise<NextResponse<ApiResponse<Paginated<PublicRouter>>>> {
  return handleRoute<Paginated<PublicRouter>>(async () => {
    await requirePermission('routers:read');

    const query = new URL(request.url).searchParams;
    const status = query.get('status');
    const isActive = query.get('isActive');
    const search = query.get('search')?.trim();

    const result = await routerService.list({
      page: readIntParam(query, 'page', 1, { min: 1, max: 10_000 }),
      pageSize: readIntParam(query, 'pageSize', DEFAULT_PAGE_SIZE, { min: 1, max: MAX_PAGE_SIZE }),
      sortBy: query.get('sortBy') ?? 'name',
      sortDirection: readSortDirection(query, 'asc'),
      ...(status !== null && isRouterStatus(status) ? { status } : {}),
      ...(isActive === null ? {} : { isActive: isActive === 'true' }),
      ...(search !== undefined && search !== '' ? { search } : {}),
    });

    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}

export async function POST(request: Request): Promise<NextResponse<ApiResponse<PublicRouter>>> {
  return handleRoute<PublicRouter>(
    async () => {
      const session = await requirePermission('routers:write');

      const input = await readJson(request, routerInputSchema);
      const result = await routerService.create(input);

      if (!result.ok) throw toDomainError(result.error);

      try {
        auditRepository.append({
          actorId: session.id,
          action: 'router.create',
          entity: 'router',
          entityId: result.value.id,
          routerId: result.value.id,
          metadata: { name: result.value.name },
        });
      } catch {
        // La auditoria no debe tumbar la operacion de negocio.
      }

      return result.value;
    },
    { status: 201 },
  );
}
