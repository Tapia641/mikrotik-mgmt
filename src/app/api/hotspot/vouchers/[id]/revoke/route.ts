import { type NextResponse } from 'next/server';

import type { ApiResponse, Voucher } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requirePermission } from '@/app/api/_lib/session';
import { toDomainError } from '@/core/errors';
import { voucherService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<Voucher>>> {
  return handleRoute<Voucher>(async () => {
    await requirePermission('vouchers:write');

    const { id } = await context.params;

    const result = await voucherService.revoke(id);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}