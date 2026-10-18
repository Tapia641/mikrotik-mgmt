import type { AuditAction, AuditLogEntry, UUID } from '@/types';

import type { Db } from '../db';
import { BaseRepository, type SqliteValue } from './base.repository';

/**
 * Repositorio append-only de `audit_log`.
 *
 * Las entradas son inmutables por diseno: no hay `update` ni `delete`. Solo
 * se expone `append`, que genera id/timestamps.
 */
export class AuditRepository extends BaseRepository<AuditLogEntry> {
  protected override readonly table = 'audit_log';

  public constructor(db?: Db) {
    super(db);
  }

  protected override toRow(_entity: AuditLogEntry): Readonly<Record<string, SqliteValue>> {
    throw new Error('AuditRepository no soporta toRow (append-only).');
  }

  protected override mapRow(_row: Record<string, unknown>): AuditLogEntry {
    throw new Error('AuditRepository no soporta mapRow (append-only).');
  }

  /** Registra una accion sensible. Un fallo de auditoria no tumba la operacion
   *  de negocio, pero se registra en consola. */
  public append(input: {
    readonly actorId: UUID | null;
    readonly action: AuditAction;
    readonly entity: string;
    readonly entityId?: string | null;
    readonly routerId?: UUID | null;
    readonly ip?: string | null;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): void {
    const id = this.newId();
    const now = this.nowIso();

    this.db
      .prepare(
        `INSERT INTO audit_log
          (id, actor_id, action, entity, entity_id, router_id, ip, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.actorId,
        input.action,
        input.entity,
        input.entityId ?? null,
        input.routerId ?? null,
        input.ip ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      );
  }
}

export const auditRepository = new AuditRepository();