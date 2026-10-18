import { type NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiResponse, Paginated, Voucher, VoucherBatchResult, VoucherMode, VoucherStatus } from '@/types';

import { handleRoute, readIntParam, readJson, readSortDirection } from '@/app/api/_lib/http';
import { requirePermission, requireRouterAccess, requireSession } from '@/app/api/_lib/session';
import { auditRepository } from '@/database/repositories';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, VOUCHER_MODES } from '@/core/constants';
import { invalidInput, toDomainError } from '@/core/errors';
import { voucherService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VOUCHER_MODE_LIST = VOUCHER_MODES as readonly VoucherMode[];

const generateSchema = z.object({
  routerId: z.string().uuid('Router invalido.'),
  profileName: z.string().trim().min(1, 'El perfil es obligatorio.').max(64),
  mode: z.enum(['username-password', 'username-only', 'password-only']),
  quantity: z.number().int().min(1, 'Cantidad minima 1.').max(500, 'Maximo 500 por lote.'),
  codeLength: z.number().int().min(4).max(12),
  charset: z.enum(['lower', 'upper', 'mixed', 'numeric', 'alphanumeric', 'custom']),
  customCharset: z.string().max(64).optional(),
  prefix: z.string().trim().max(8).optional(),
  passwordLength: z.number().int().min(4).max(12).optional(),
  sharedUsername: z.string().trim().max(64).optional(),
  validity: z.string().trim().max(32).nullable().optional(),
  limitUptime: z.string().trim().max(32).nullable().optional(),
  limitBytesIn: z.number().int().min(0).optional(),
  limitBytesOut: z.number().int().min(0).optional(),
  price: z.number().min(0).optional(),
  comment: z.string().trim().max(255).optional(),
});

const VOUCHER_STATUSES = [
  'available', 'sold', 'active', 'used', 'expired', 'revoked',
] as const satisfies readonly VoucherStatus[];

function isVoucherStatus(value: string): value is VoucherStatus {
  return (VOUCHER_STATUSES as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<NextResponse<ApiResponse<Paginated<Voucher>>>> {
  return handleRoute<Paginated<Voucher>>(async () => {
    await requirePermission('vouchers:read');

    const query = new URL(request.url).searchParams;
    const routerId = query.get('routerId');

    const result = await voucherService.list({
      routerId: routerId !== null && routerId !== '' ? (routerId as never) : undefined,
      batchId: query.get('batchId') ?? undefined,
      profileName: query.get('profileName') ?? undefined,
      status: query.get('status') !== null && isVoucherStatus(query.get('status')!) ? (query.get('status') as VoucherStatus) : undefined,
      code: query.get('code') ?? undefined,
      page: readIntParam(query, 'page', 1, { min: 1, max: 10_000 }),
      pageSize: readIntParam(query, 'pageSize', DEFAULT_PAGE_SIZE, { min: 1, max: MAX_PAGE_SIZE }),
      sortBy: query.get('sortBy') ?? 'createdAt',
      sortDirection: readSortDirection(query, 'desc'),
    });

    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}

export async function POST(request: Request): Promise<NextResponse<ApiResponse<VoucherBatchResult>>> {
  return handleRoute<VoucherBatchResult>(
    async () => {
      await requirePermission('vouchers:write');

      const session = await requireSession();
      const input = await readJson(request, generateSchema);
      await requireRouterAccess(input.routerId);

      const result = await voucherService.generateBatch(
        {
          routerId: input.routerId,
          profileName: input.profileName,
          mode: input.mode,
          quantity: input.quantity,
          codeLength: input.codeLength,
          charset: input.charset,
          customCharset: input.customCharset,
          prefix: input.prefix,
          passwordLength: input.passwordLength,
          sharedUsername: input.sharedUsername,
          validity: input.validity ?? null,
          limitUptime: input.limitUptime ?? null,
          limitBytesIn: input.limitBytesIn,
          limitBytesOut: input.limitBytesOut,
          price: input.price ?? 0,
          comment: input.comment,
        },
        session.id,
      );

      if (!result.ok) throw toDomainError(result.error);

      try {
        auditRepository.append({
          actorId: session.id,
          action: 'voucher.generate',
          entity: 'voucher_batch',
          entityId: result.value.batchId,
          routerId: input.routerId,
          metadata: { quantity: result.value.totalCreated, profile: input.profileName },
        });
      } catch {
        // La auditoria no debe tumbar la operacion de negocio.
      }

      return result.value;
    },
    { status: 201 },
  );
}