import type { NextResponse } from 'next/server';

import type { ApiResponse, CurrentSession } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requireSession } from '@/app/api/_lib/session';
import { permissionsOf } from '@/core/auth/authz';

export const runtime = 'nodejs';

/**
 * `GET /api/auth/me` — quién soy y qué puedo hacer.
 * La UI lo usa para pintar el menú; la autorizacion real se aplica en cada
 * Route Handler (`requirePermission`), nunca en el cliente.
 */
export async function GET(): Promise<NextResponse<ApiResponse<CurrentSession>>> {
  return handleRoute<CurrentSession>(async () => {
    const user = await requireSession();

    return { user, permissions: permissionsOf(user.role) };
  });
}
