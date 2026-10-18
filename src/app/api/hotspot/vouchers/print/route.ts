import { type NextResponse } from 'next/server';

import type { ApiResponse, VoucherFormat, VoucherPrintJob } from '@/types';

import { handleRoute } from '@/app/api/_lib/http';
import { requirePermission } from '@/app/api/_lib/session';
import { invalidInput, toDomainError } from '@/core/errors';
import { voucherService } from '@/core/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATS = ['qr', 'card', 'thermal', 'label', 'a4-grid'] as const;

export async function GET(request: Request): Promise<NextResponse<ApiResponse<VoucherPrintJob>>> {
  return handleRoute<VoucherPrintJob>(async () => {
    await requirePermission('vouchers:read');

    const query = new URL(request.url).searchParams;
    const batchId = query.get('batchId');
    if (batchId === null || batchId === '') {
      throw toDomainError(invalidInput('El lote es obligatorio.', { field: 'batchId' }));
    }

    const formatRaw = query.get('format') ?? 'qr';
    if (!(FORMATS as readonly string[]).includes(formatRaw)) {
      throw toDomainError(invalidInput('Formato de impresion no soportado.'));
    }

    const result = await voucherService.buildPrintJob(batchId, formatRaw as VoucherFormat);
    if (!result.ok) throw toDomainError(result.error);

    return result.value;
  });
}