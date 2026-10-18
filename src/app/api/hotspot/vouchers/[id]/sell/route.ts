import { type NextResponse } from 'next/server';

import type { ApiResponse, Voucher } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requirePermission } from '@/app/api/_lib/session';
import { invalidInput, toDomainError } from '@/core/errors';
import { voucherService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse<ApiResponse<Voucher>>> {
  return handleRoute<Voucher>(async () => {
    await requirePermission('vouchers:write');

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { resellerId?: string | null };

    const result = await voucherService.sell(id, body.resellerId ?? null);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}