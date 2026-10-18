import type { ResellerProfile, UUID, VoucherMode, VoucherValidityUnit } from '@/types';

import type { Db } from '../db';
import {
  asBoolean,
  asInteger,
  asNullableString,
  asNumber,
  asString,
  BaseRepository,
  cond,
  type SqlRow,
} from './base.repository';

/**
 * Repositorio de `reseller_profiles` (paquetes vendibles). Borrado logico.
 *
 * `limit_bytes_*` usa `0` como "ilimitado" (igual que RouterOS), por eso se
 * decodifica con `asInteger` y no como bucket nulo.
 */
export class ResellerProfileRepository extends BaseRepository<ResellerProfile> {
  protected override readonly table = 'reseller_profiles';
  protected override readonly usesSoftDelete = true;

  public constructor(db?: Db) {
    super(db);
  }

  protected override toRow(profile: ResellerProfile): SqlRow {
    return {
      id: profile.id,
      name: profile.name,
      router_id: profile.routerId,
      price: profile.price,
      selling_price: profile.sellingPrice,
      currency: profile.currency,
      validity: profile.validity,
      validity_unit: profile.validityUnit,
      hotspot_profile_name: profile.hotspotProfileName,
      limit_uptime: profile.limitUptime,
      limit_bytes_in: profile.limitBytesIn,
      limit_bytes_out: profile.limitBytesOut,
      mode: profile.mode,
      shared_users: profile.sharedUsers,
      is_active: this.bool(profile.isActive),
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
      deleted_at: profile.deletedAt ?? null,
    };
  }

  protected override mapRow(row: SqlRow): ResellerProfile {
    return {
      id: asString(row.id),
      name: asString(row.name),
      routerId: asString(row.router_id),
      price: asNumber(row.price),
      sellingPrice: row.selling_price === null ? null : asNumber(row.selling_price),
      currency: asString(row.currency),
      validity: asNullableString(row.validity),
      // El CHECK de la tabla garantiza el dominio.
      validityUnit: asString(row.validity_unit) as VoucherValidityUnit,
      hotspotProfileName: asString(row.hotspot_profile_name),
      limitUptime: asNullableString(row.limit_uptime),
      limitBytesIn: asInteger(row.limit_bytes_in),
      limitBytesOut: asInteger(row.limit_bytes_out),
      mode: asString(row.mode) as VoucherMode,
      sharedUsers: asInteger(row.shared_users),
      isActive: asBoolean(row.is_active),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      deletedAt: asNullableString(row.deleted_at),
    };
  }

  /** Paquetes vivos de un router, activos primero y por nombre. */
  public findByRouter(routerId: UUID): ResellerProfile[] {
    return this.selectAll(
      this.scope(cond('router_id = ?', routerId)),
      'ORDER BY is_active DESC, name ASC',
    );
  }

  /** Paquetes con un nombre dado en el router (nombre NO es unico en SQLite). */
  public findByName(routerId: UUID, name: string): ResellerProfile[] {
    return this.selectAll(this.scope(cond('router_id = ?', routerId), cond('name = ?', name)));
  }

  /** Cuantos paquetes activos tiene un router (validacion de borrado). */
  public countActiveByRouter(routerId: UUID): number {
    return this.count(this.scope(cond('router_id = ?', routerId), cond('is_active = 1')));
  }
}

export const resellerProfileRepository = new ResellerProfileRepository();
