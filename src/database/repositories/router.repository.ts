import type { Paginated, Router, RouterQuery, RouterStatus, UUID } from '@/types';

import type { Db } from '../db';
import {
  asBoolean,
  asInteger,
  asNullableString,
  asString,
  BaseRepository,
  cond,
  type SqlRow,
} from './base.repository';

/**
 * Repositorio de `routers`. Borrado logico (`deleted_at`).
 *
 * `password_encrypted` guarda el payload AES-256-GCM; este repositorio NO
 * cifra ni descifra: transporta el valor tal cual (ver `@/lib/crypto`).
 */
export class RouterRepository extends BaseRepository<Router> {
  protected override readonly table = 'routers';
  protected override readonly usesSoftDelete = true;

  public constructor(db?: Db) {
    super(db);
  }

  protected override toRow(router: Router): SqlRow {
    return {
      id: router.id,
      name: router.name,
      description: router.description,
      host: router.host,
      port: router.port,
      protocol: router.protocol,
      username: router.username,
      password_encrypted: router.passwordEncrypted,
      tls_insecure: this.bool(router.tlsInsecure),
      timeout_ms: router.timeoutMs,
      timezone: router.timezone,
      currency: router.currency,
      is_active: this.bool(router.isActive),
      status: router.status,
      last_seen_at: router.lastSeenAt,
      last_error: router.lastError,
      created_at: router.createdAt,
      updated_at: router.updatedAt,
      deleted_at: router.deletedAt ?? null,
    };
  }

  protected override mapRow(row: SqlRow): Router {
    return {
      id: asString(row.id),
      name: asString(row.name),
      description: asNullableString(row.description),
      host: asString(row.host),
      port: asInteger(row.port),
      // El CHECK de la tabla garantiza el dominio; evitamos revalidar por fila.
      protocol: asString(row.protocol) as Router['protocol'],
      username: asString(row.username),
      passwordEncrypted: asString(row.password_encrypted),
      tlsInsecure: asBoolean(row.tls_insecure),
      timeoutMs: asInteger(row.timeout_ms),
      timezone: asString(row.timezone),
      currency: asString(row.currency),
      isActive: asBoolean(row.is_active),
      status: asString(row.status) as RouterStatus,
      lastSeenAt: asNullableString(row.last_seen_at),
      lastError: asNullableString(row.last_error),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      deletedAt: asNullableString(row.deleted_at),
    };
  }

  /** Listado paginado con filtros del panel (excluye borrados). */
  public search(query: RouterQuery = {}): Paginated<Router> {
    const term = query.search?.trim();

    return this.paginate(
      this.scope(
        query.status !== undefined && cond('status = ?', query.status),
        query.isActive !== undefined && cond('is_active = ?', query.isActive ? 1 : 0),
        term !== undefined && term !== ''
          ? cond(
              '(name LIKE ? OR host LIKE ? OR COALESCE(description, \'\') LIKE ?)',
              `%${term}%`,
              `%${term}%`,
              `%${term}%`,
            )
          : false,
      ),
      query,
    );
  }

  /** Routers habilitados y vivos, ordenados por nombre (para selectores). */
  public findActive(): Router[] {
    return this.selectAll(this.scope(cond('is_active = 1')), 'ORDER BY name ASC');
  }

  public findByHost(host: string): Router | null {
    return this.selectOne(this.scope(cond('host = ?', host)));
  }

  /** `name` es UNIQUE en la tabla: se usa para dar un error de dominio legible. */
  public findByName(name: string): Router | null {
    return this.selectOne(this.scope(cond('name = ?', name)));
  }

  /**
   * Actualiza el estado de conexion sin reconstruir la entidad.
   * `last_seen_at` solo avanza cuando el router responde (`online`).
   */
  public updateStatus(id: UUID, status: RouterStatus, lastError: string | null = null): void {
    const now = this.nowIso();

    this.run(
      `UPDATE routers
          SET status = ?,
              last_error = ?,
              updated_at = ?,
              last_seen_at = CASE WHEN ? = 'online' THEN ? ELSE last_seen_at END
        WHERE id = ?`,
      status,
      lastError,
      now,
      status,
      now,
      id,
    );
  }
}

export const routerRepository = new RouterRepository();
