import type { NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiResponse, PublicRouter } from '@/types';

import { handleRoute, readJson } from '@/app/api/_lib/http';
import { requirePermission, requireRouterAccess } from '@/app/api/_lib/session';
import { auditRepository } from '@/database/repositories';
import { toDomainError } from '@/core/errors';
import { routerService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET` / `PATCH` / `DELETE /api/routers/[id]`.
 *
 * En Next 16 `params` es una promesa: hay que esperarla antes de leer el id.
 */

const routerPatchSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(64, 'Nombre demasiado largo.').optional(),
  description: z.string().trim().max(255, 'Descripcion demasiado larga.').nullable().optional(),
  host: z
    .string()
    .trim()
    .min(1, 'El host es obligatorio.')
    .max(255, 'Host demasiado largo.')
    .refine((value) => !/\s/.test(value), 'El host no puede contener espacios.')
    .optional(),
  port: z.number().int('El puerto debe ser entero.').min(1).max(65_535).optional(),
  protocol: z.enum(['api', 'api-ssl']).optional(),
  username: z.string().trim().min(1, 'El usuario es obligatorio.').max(64).optional(),
  /** En edicion es OPCIONAL: si no viene, la contrasena guardada no se toca. */
  password: z.string().min(1, 'La contrasena no puede estar vacia.').max(128).optional(),
  tlsInsecure: z.boolean().optional(),
  timeoutMs: z.number().int().min(500).max(60_000).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().length(3, 'La moneda debe tener 3 letras.').optional(),
  isActive: z.boolean().optional(),
});

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<PublicRouter>>> {
  return handleRoute<PublicRouter>(async () => {
    const { id } = await context.params;
    await requireRouterAccess(id);

    const result = await routerService.getById(id);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<PublicRouter>>> {
  return handleRoute<PublicRouter>(async () => {
    const { id } = await context.params;
    await requirePermission('routers:write');
    await requireRouterAccess(id);

    const input = await readJson(request, routerPatchSchema);
    const result = await routerService.update(id, input);

    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<{ readonly id: string }>>> {
  return handleRoute<{ readonly id: string }>(async () => {
    const session = await requirePermission('routers:write');
    const { id } = await context.params;
    await requireRouterAccess(id);

    const result = await routerService.remove(id);
    if (!result.ok) throw toDomainError(result.error);

    try {
      auditRepository.append({
        actorId: session.id,
        action: 'router.delete',
        entity: 'router',
        entityId: id,
        routerId: id,
      });
    } catch {
      // La auditoria no debe tumbar la operacion de negocio.
    }

    return { id };
  });
}
