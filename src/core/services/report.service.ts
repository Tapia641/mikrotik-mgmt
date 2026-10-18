import type {
  AppError,
  DashboardMetrics,
  DateRange,
  Paginated,
  PaginationParams,
  Result,
  SalesSummary,
  Transaction,
  UUID,
} from '@/types';

import { routerRepository } from '@/database/repositories/router.repository';
import { voucherRepository } from '@/database/repositories/voucher.repository';

import { DomainError } from '@/core/errors';

/**
 * Agregaciones para dashboard y reportes.
 *
 * Las ventas se resuelven en SQLite (fuente de verdad); los contadores en vivo
 * (sesiones activas) se piden al router solo si esta disponible.
 */
export interface ReportServiceDeps {
  readonly routers?: typeof routerRepository;
  readonly vouchers?: typeof voucherRepository;
  readonly now?: () => Date;
}

export interface ReportService {
  getDashboardMetrics(routerId: UUID | null): Promise<Result<DashboardMetrics>>;
  getSalesSummary(range: DateRange, routerId?: UUID): Promise<Result<SalesSummary>>;
  listTransactions(
    params: PaginationParams & { readonly range?: DateRange; readonly routerId?: UUID },
  ): Promise<Result<Paginated<Transaction>>>;
  recordTransaction(input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Result<Transaction>>;
}

/* ── Utilidades del canal `Result` ───────────────────────────────────────── */

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(error: AppError): Result<T> {
  return { ok: false, error };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createReportService(deps: ReportServiceDeps = {}): ReportService {
  const routers = deps.routers ?? routerRepository;
  const vouchers = deps.vouchers ?? voucherRepository;
  const now = deps.now ?? ((): Date => new Date());

  return {
    async getDashboardMetrics(routerId) {
      const allRouters = routers.search({ pageSize: 1000 });
      const onlineRouters = allRouters.items.filter((r) => r.status === 'online').length;

      const voucherSummary = vouchers.summarize(routerId === null ? {} : { routerId });
      const available = voucherSummary.byStatus.available ?? 0;

      const today = isoDay(now());
      const monthStart = `${today.slice(0, 7)}-01`;

      const soldToday = vouchers.search({
        ...(routerId === null ? {} : { routerId }),
        status: 'sold',
        createdRange: { from: `${today}T00:00:00.000Z`, to: `${today}T23:59:59.999Z` },
        pageSize: 1000,
      });
      const soldMonth = vouchers.search({
        ...(routerId === null ? {} : { routerId }),
        status: 'sold',
        createdRange: { from: `${monthStart}T00:00:00.000Z`, to: `${today}T23:59:59.999Z` },
        pageSize: 1000,
      });

      const revenueToday = soldToday.items.reduce((sum, v) => sum + v.price, 0);
      const revenueMonth = soldMonth.items.reduce((sum, v) => sum + v.price, 0);

      return success({
        capturedAt: now().toISOString(),
        routerId,
        totalRouters: allRouters.total,
        onlineRouters,
        activeSessions: 0,
        vouchersAvailable: available,
        vouchersSoldToday: soldToday.total,
        revenueToday: Math.round(revenueToday * 100) / 100,
        revenueMonth: Math.round(revenueMonth * 100) / 100,
        currency: voucherSummary.currency,
        cpuLoad: null,
        uptime: null,
      });
    },

    async getSalesSummary(range, routerId) {
      const summary = vouchers.summarize({
        ...(routerId === undefined ? {} : { routerId }),
        createdRange: range,
      });

      const byProfileMap = new Map<string, { quantity: number; revenue: number }>();
      const byDayMap = new Map<string, { quantity: number; revenue: number }>();

      const sold = vouchers.search({
        ...(routerId === undefined ? {} : { routerId }),
        status: 'sold',
        createdRange: range,
        pageSize: 1000,
      });

      for (const voucher of sold.items) {
        const profile = byProfileMap.get(voucher.profileName) ?? { quantity: 0, revenue: 0 };
        profile.quantity += 1;
        profile.revenue += voucher.price;
        byProfileMap.set(voucher.profileName, profile);

        const day = voucher.createdAt.slice(0, 10);
        const dayEntry = byDayMap.get(day) ?? { quantity: 0, revenue: 0 };
        dayEntry.quantity += 1;
        dayEntry.revenue += voucher.price;
        byDayMap.set(day, dayEntry);
      }

      return success({
        range,
        currency: summary.currency,
        totalVouchers: sold.total,
        totalRevenue: summary.totalValue,
        totalCost: null,
        byProfile: [...byProfileMap.entries()].map(([key, value]) => ({
          key,
          label: key,
          quantity: value.quantity,
          revenue: Math.round(value.revenue * 100) / 100,
        })),
        byReseller: [],
        byDay: [...byDayMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => ({
            key,
            label: key,
            quantity: value.quantity,
            revenue: Math.round(value.revenue * 100) / 100,
          })),
      });
    },

    async listTransactions() {
      // No hay repositorio de transacciones todavia: se devuelve vacio.
      return success({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    },

    async recordTransaction() {
      return fail(new DomainError({ code: 'NOT_IMPLEMENTED', message: 'recordTransaction pendiente.', status: 501 }));
    },
  };
}

export const reportService: ReportService = createReportService();