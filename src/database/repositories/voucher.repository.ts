import type {
  Paginated,
  UUID,
  Voucher,
  VoucherBatch,
  VoucherQuery,
  VoucherQuerySummary,
  VoucherStatus,
} from '@/types';
import { VOUCHER_STATUSES } from '@/core/constants';

import type { Db } from '../db';
import {
  asInteger,
  asNullableString,
  asNumber,
  asString,
  BaseRepository,
  cond,
  type CreateInput,
  type SqlRow,
  type SqliteValue,
  type WhereClause,
} from './base.repository';

/**
 * Repositorio de `vouchers`. Sin borrado logico: un voucher se *revoca*
 * (`status = 'revoked'`), no se borra, para preservar la trazabilidad de ventas.
 *
 * La generacion masiva (`insertMany`) es atomica: si un codigo duplica el lote
 * completo revierte, de modo que un batch nunca queda a medias.
 */
export class VoucherRepository extends BaseRepository<Voucher> {
  protected override readonly table = 'vouchers';

  public constructor(db?: Db) {
    super(db);
  }

  protected override toRow(voucher: Voucher): SqlRow {
    return {
      id: voucher.id,
      code: voucher.code,
      password: voucher.password,
      router_id: voucher.routerId,
      profile_name: voucher.profileName,
      validity: voucher.validity,
      limit_uptime: voucher.limitUptime,
      limit_bytes_in: voucher.limitBytesIn,
      limit_bytes_out: voucher.limitBytesOut,
      price: voucher.price,
      currency: voucher.currency,
      status: voucher.status,
      batch_id: voucher.batchId,
      reseller_id: voucher.resellerId,
      sold_at: voucher.soldAt,
      activated_at: voucher.activatedAt,
      expires_at: voucher.expiresAt,
      comment: voucher.comment,
      created_at: voucher.createdAt,
      updated_at: voucher.updatedAt,
    };
  }

  protected override mapRow(row: SqlRow): Voucher {
    return {
      id: asString(row.id),
      code: asString(row.code),
      password: asNullableString(row.password),
      routerId: asString(row.router_id),
      profileName: asString(row.profile_name),
      validity: asNullableString(row.validity),
      limitUptime: asNullableString(row.limit_uptime),
      limitBytesIn: asInteger(row.limit_bytes_in),
      limitBytesOut: asInteger(row.limit_bytes_out),
      price: asNumber(row.price),
      currency: asString(row.currency),
      status: asString(row.status) as VoucherStatus,
      batchId: asNullableString(row.batch_id),
      resellerId: asNullableString(row.reseller_id),
      soldAt: asNullableString(row.sold_at),
      activatedAt: asNullableString(row.activated_at),
      expiresAt: asNullableString(row.expires_at),
      comment: asNullableString(row.comment),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  /** Traduce `VoucherQuery` a SQL (compartido por `search` y `summarize`). */
  private searchWhere(query: VoucherQuery): WhereClause {
    const code = query.code?.trim();

    const conditions = [
      query.routerId !== undefined && cond('router_id = ?', query.routerId),
      query.batchId !== undefined && cond('batch_id = ?', query.batchId),
      query.resellerId !== undefined && cond('reseller_id = ?', query.resellerId),
      query.profileName !== undefined && cond('profile_name = ?', query.profileName),
      query.status !== undefined && cond('status = ?', query.status),
      code !== undefined && code !== '' && cond('code LIKE ?', `%${code}%`),
      query.createdRange !== undefined &&
        cond('created_at >= ? AND created_at <= ?', query.createdRange.from, query.createdRange.to),
    ];

    return this.scope(...conditions);
  }

  public search(query: VoucherQuery = {}): Paginated<Voucher> {
    return this.paginate(this.searchWhere(query), query);
  }

  public findByCode(routerId: UUID, code: string): Voucher | null {
    return this.selectOne(this.scope(cond('router_id = ?', routerId), cond('code = ?', code)));
  }

  /** Crea el registro de trazabilidad de un lote. */
  public createBatch(input: {
    readonly routerId: UUID;
    readonly profileName: string;
    readonly mode: string;
    readonly quantity: number;
    readonly price: number;
    readonly request: unknown;
    readonly createdBy: UUID | null;
  }): VoucherBatch {
    const id = this.newId();
    const now = this.nowIso();

    this.db
      .prepare(
        `INSERT INTO voucher_batches
          (id, router_id, profile_name, mode, quantity, price, request_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.routerId,
        input.profileName,
        input.mode,
        input.quantity,
        input.price,
        JSON.stringify(input.request),
        input.createdBy,
        now,
        now,
      );

    return {
      id,
      routerId: input.routerId,
      profileName: input.profileName,
      mode: input.mode as VoucherBatch['mode'],
      quantity: input.quantity,
      price: input.price,
      request: input.request as VoucherBatch['request'],
      voucherIds: [],
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
  }

  public findBatchById(id: UUID): VoucherBatch | null {
    const row = this.db
      .prepare<SqliteValue[], SqlRow>('SELECT * FROM voucher_batches WHERE id = ?')
      .get(id);

    if (row === undefined) return null;

    const voucherIds = this.db
      .prepare<SqliteValue[], { id: string }>('SELECT id FROM vouchers WHERE batch_id = ?')
      .all(id)
      .map((r) => r.id);

    return {
      id: asString(row.id),
      routerId: asString(row.router_id),
      profileName: asString(row.profile_name),
      mode: asString(row.mode) as VoucherBatch['mode'],
      quantity: asInteger(row.quantity),
      price: asNumber(row.price),
      request: JSON.parse(asString(row.request_json)) as VoucherBatch['request'],
      voucherIds,
      createdBy: asNullableString(row.created_by),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  /** Crea el lote y sus vouchers en UNA transaccion (todo o nada). */
  public createBatchWithVouchers(
    batchInput: {
      readonly routerId: UUID;
      readonly profileName: string;
      readonly mode: string;
      readonly quantity: number;
      readonly price: number;
      readonly request: unknown;
      readonly createdBy: UUID | null;
    },
    voucherInputs: readonly Omit<CreateInput<Voucher>, 'batchId'>[],
  ): { readonly batch: VoucherBatch; readonly vouchers: readonly Voucher[] } {
    const batchId = this.newId();
    const now = this.nowIso();

    const vouchers: Voucher[] = voucherInputs.map((input) => ({
      ...input,
      id: this.newId(),
      batchId,
      createdAt: now,
      updatedAt: now,
    })) as unknown as Voucher[];

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO voucher_batches
            (id, router_id, profile_name, mode, quantity, price, request_json, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          batchId,
          batchInput.routerId,
          batchInput.profileName,
          batchInput.mode,
          batchInput.quantity,
          batchInput.price,
          JSON.stringify(batchInput.request),
          batchInput.createdBy,
          now,
          now,
        );

      for (const voucher of vouchers) this.insertRow(voucher);
    });

    transaction();

    const batch: VoucherBatch = {
      id: batchId,
      routerId: batchInput.routerId,
      profileName: batchInput.profileName,
      mode: batchInput.mode as VoucherBatch['mode'],
      quantity: batchInput.quantity,
      price: batchInput.price,
      request: batchInput.request as VoucherBatch['request'],
      voucherIds: vouchers.map((v) => v.id),
      createdBy: batchInput.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    return { batch, vouchers };
  }

  /** Inserta el lote completo en UNA transaccion. Todo o nada. */
  public insertMany(inputs: readonly CreateInput<Voucher>[]): Voucher[] {
    const now = this.nowIso();
    const vouchers = inputs.map(
      (input) =>
        ({
          ...input,
          id: this.newId(),
          createdAt: now,
          updatedAt: now,
        }) as unknown as Voucher,
    );

    const insertBatch = this.db.transaction((items: readonly Voucher[]) => {
      for (const voucher of items) this.insertRow(voucher);
    });

    insertBatch(vouchers);
    return vouchers;
  }

  /** Marca el voucher como vendido a un reseller (paso 2 del flujo de venta). */
  public markSold(id: UUID, resellerId: UUID | null, soldAt: string = this.nowIso()): void {
    this.touch(id, { status: 'sold', reseller_id: resellerId, sold_at: soldAt });
  }

  /** Agregados por estado para el resumen de inventario del panel. */
  public summarize(query: VoucherQuery = {}): VoucherQuerySummary {
    const where = this.searchWhere(query);
    const rows = this.db
      .prepare<SqliteValue[], { status: string; total: number; value: number | null }>(
        `SELECT status, COUNT(*) AS total, SUM(price) AS value
           FROM vouchers ${where.sql}
          GROUP BY status`,
      )
      .all(...where.params);

    const byStatus = Object.fromEntries(
      VOUCHER_STATUSES.map((status): [string, number] => [status, 0]),
    ) as Record<VoucherStatus, number>;

    let total = 0;
    let totalValue = 0;

    for (const row of rows) {
      const status = row.status as VoucherStatus;
      if (status in byStatus) byStatus[status] = row.total;
      total += row.total;
      totalValue += row.value ?? 0;
    }

    // Monedas presentes en el subconjunto filtrado (no se puede agregar con
    // `MIN(currency)` porque perderia la segunda moneda dentro del mismo grupo).
    const currencies = new Set(
      this.db
        .prepare<SqliteValue[], { currency: string }>(
          `SELECT DISTINCT currency FROM vouchers ${where.sql}`,
        )
        .all(...where.params)
        .map((row) => row.currency),
    );

    return {
      total,
      byStatus,
      totalValue: Math.round(totalValue * 100) / 100,
      // Un lote pertenece a un solo router; si el filtro abarca varios, el
      // resumen no puede reducirse a una moneda.
      currency: currencies.size === 1 ? [...currencies][0]! : currencies.size === 0 ? 'USD' : 'MIXED',
    };
  }
}

export const voucherRepository = new VoucherRepository();
