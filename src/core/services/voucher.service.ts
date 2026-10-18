import type {
  AppError,
  Paginated,
  Result,
  UUID,
  Voucher,
  VoucherBatchRequest,
  VoucherBatchResult,
  VoucherPrintJob,
  VoucherQuery,
  VoucherQuerySummary,
} from '@/types';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/core/constants';
import { invalidInput, notFound } from '@/core/errors';
import { hotspotCommands } from '@/core/mikrotik/commands/hotspot';

import { createRosExecutor, type RosExecutor } from './ros-exec';
import { generateVoucherPairs } from '@/lib/voucher-code';

import { type VoucherRepository, voucherRepository } from '@/database/repositories';
import type { CreateInput } from '@/database/repositories';

/**
 * Nucleo funcional (herencia de Mikhmon v3): generacion, venta e impresion de
 * vouchers. Persiste en SQLite y da de alta los usuarios en RouterOS.
 */
export interface VoucherServiceDeps {
  readonly executor?: RosExecutor;
  readonly vouchers?: VoucherRepository;
  readonly now?: () => number;
}

export interface VoucherService {
  generateBatch(request: VoucherBatchRequest, createdBy: UUID | null): Promise<Result<VoucherBatchResult>>;
  list(query: VoucherQuery): Promise<Result<Paginated<Voucher>>>;
  summarize(query: VoucherQuery): Promise<Result<VoucherQuerySummary>>;
  sell(voucherId: UUID, resellerId: UUID | null): Promise<Result<Voucher>>;
  revoke(voucherId: UUID): Promise<Result<Voucher>>;
  buildPrintJob(batchId: UUID, format: VoucherPrintJob['format']): Promise<Result<VoucherPrintJob>>;
}

/* ── Utilidades del canal `Result` ───────────────────────────────────────── */

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(error: AppError): Result<T> {
  return { ok: false, error };
}

/* ── Validacion ──────────────────────────────────────────────────────────── */

function validateRequest(request: VoucherBatchRequest): AppError | null {
  if (request.quantity < 1 || !Number.isInteger(request.quantity)) {
    return invalidInput('La cantidad debe ser un entero positivo.');
  }
  if (request.codeLength < 1 || !Number.isInteger(request.codeLength)) {
    return invalidInput('La longitud del codigo debe ser un entero positivo.');
  }
  if (request.price < 0) {
    return invalidInput('El precio no puede ser negativo.');
  }
  if (request.profileName.trim() === '') {
    return invalidInput('El perfil es obligatorio.');
  }

  return null;
}

export function createVoucherService(deps: VoucherServiceDeps = {}): VoucherService {
  const executor = deps.executor ?? createRosExecutor();
  const vouchers = deps.vouchers ?? voucherRepository;
  const now = deps.now ?? ((): number => Date.now());

  return {
    async generateBatch(request, createdBy) {
      const problem = validateRequest(request);
      if (problem !== null) return fail(problem);

      const found = executor.find(request.routerId);
      if (!found.ok) return found;
      const router = found.value;

      let pairs;
      try {
        pairs = generateVoucherPairs({
          mode: request.mode,
          quantity: request.quantity,
          codeLength: request.codeLength,
          charset: request.charset,
          customCharset: request.customCharset,
          prefix: request.prefix,
          passwordLength: request.passwordLength,
          sharedUsername: request.sharedUsername,
        });
      } catch (cause) {
        return fail(invalidInput(cause instanceof Error ? cause.message : 'No se pudieron generar los codigos.'));
      }

      const createdInputs: Array<Omit<CreateInput<Voucher>, 'batchId'>> = [];
      const failed: Array<{ readonly code: string; readonly reason: string }> = [];

      for (const pair of pairs) {
        const username =
          request.mode === 'password-only' ? (request.sharedUsername ?? 'voucher') : pair.code;
        const password =
          request.mode === 'username-only'
            ? pair.code
            : (pair.password ?? pair.code);

        const params: Record<string, string | number | boolean> = {};
        if (request.limitUptime !== null) params['limit-uptime'] = request.limitUptime;
        if (request.limitBytesIn !== undefined) params['limit-bytes-in'] = request.limitBytesIn;
        if (request.limitBytesOut !== undefined) params['limit-bytes-out'] = request.limitBytesOut;
        if (request.comment !== undefined && request.comment !== null) params.comment = request.comment;

        try {
          await executor.executeOn(
            router,
            hotspotCommands.addUser(username, password, request.profileName, params),
          );

          createdInputs.push({
            code: pair.code,
            password: request.mode === 'username-only' ? null : password,
            routerId: request.routerId,
            profileName: request.profileName,
            validity: request.validity,
            limitUptime: request.limitUptime,
            limitBytesIn: request.limitBytesIn ?? 0,
            limitBytesOut: request.limitBytesOut ?? 0,
            price: request.price,
            currency: 'USD',
            status: 'available',
            resellerId: null,
            soldAt: null,
            activatedAt: null,
            expiresAt: null,
            comment: request.comment ?? null,
          });
        } catch (cause) {
          failed.push({ code: pair.code, reason: cause instanceof Error ? cause.message : 'Error desconocido.' });
        }
      }

      if (createdInputs.length === 0) {
        return fail(
          invalidInput('No se pudo crear ningun voucher en el router.', {
            failed,
          }),
        );
      }

      const { batch, vouchers: persisted } = vouchers.createBatchWithVouchers(
        {
          routerId: request.routerId,
          profileName: request.profileName,
          mode: request.mode,
          quantity: request.quantity,
          price: request.price,
          request,
          createdBy,
        },
        createdInputs,
      );

      return success({
        batchId: batch.id,
        created: persisted,
        failed,
        totalRequested: request.quantity,
        totalCreated: persisted.length,
      });
    },

    async list(query) {
      const result = vouchers.search(query);

      return success(result);
    },

    async summarize(query) {
      const summary = vouchers.summarize(query);

      return success(summary);
    },

    async sell(voucherId, resellerId) {
      const voucher = vouchers.findById(voucherId);
      if (voucher === null) return fail(notFound('Voucher', voucherId));

      if (voucher.status !== 'available') {
        return fail(invalidInput(`El voucher no esta disponible (estado: ${voucher.status}).`));
      }

      vouchers.markSold(voucherId, resellerId);

      const updated = vouchers.findById(voucherId);
      if (updated === null) return fail(notFound('Voucher', voucherId));

      return success(updated);
    },

    async revoke(voucherId) {
      const voucher = vouchers.findById(voucherId);
      if (voucher === null) return fail(notFound('Voucher', voucherId));

      if (voucher.status === 'revoked') {
        return success(voucher);
      }

      vouchers.update(voucherId, { status: 'revoked' });

      const updated = vouchers.findById(voucherId);
      if (updated === null) return fail(notFound('Voucher', voucherId));

      return success(updated);
    },

    async buildPrintJob(batchId, format) {
      const batch = vouchers.findBatchById(batchId);
      if (batch === null) return fail(notFound('VoucherBatch', batchId));

      const vouchersInBatch = batch.voucherIds
        .map((id) => vouchers.findById(id))
        .filter((v): v is Voucher => v !== null);

      // Genera el QR de cada codigo en paralelo; un fallo de un codigo no
      // tumba el lote entero (se deja sin QR y la UI muestra el texto).
      const qrDataUrls = await Promise.all(
        vouchersInBatch.map(async (voucher) => {
          try {
            const QRCode = await import('qrcode');

            return await QRCode.toDataURL(voucher.code, { width: 128, margin: 1 });
          } catch {
            return null;
          }
        }),
      );

      return success({
        batchId,
        format,
        vouchers: vouchersInBatch,
        qrDataUrls,
        meta: { company: '' },
        generatedAt: new Date(now()).toISOString(),
      });
    },
  };
}

export const voucherService: VoucherService = createVoucherService();