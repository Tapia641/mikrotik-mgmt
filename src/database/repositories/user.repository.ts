import type { PanelUser, UUID, UserRole, UserStatus } from '@/types';

import type { Db } from '../db';
import {
  asBoolean,
  asJson,
  asNullableString,
  asString,
  BaseRepository,
  cond,
  type SqlRow,
} from './base.repository';

/**
 * Repositorio de `users` (administradores del panel). Borrado logico.
 *
 * Ojo: `router_ids` es un array de UUID serializado como JSON (SQLite no tiene
 * tipo array). `password_hash` siempre llega ya derivado con bcrypt: el hashing
 * vive en el servicio de autenticacion, no aqui.
 */
export class UserRepository extends BaseRepository<PanelUser> {
  protected override readonly table = 'users';
  protected override readonly usesSoftDelete = true;

  public constructor(db?: Db) {
    super(db);
  }

  protected override toRow(user: PanelUser): SqlRow {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      password_hash: user.passwordHash,
      role: user.role,
      status: user.status,
      reseller_profile_id: user.resellerProfileId,
      router_ids: this.json(user.routerIds),
      last_login_at: user.lastLoginAt,
      must_change_password: this.bool(user.mustChangePassword),
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      deleted_at: user.deletedAt ?? null,
    };
  }

  protected override mapRow(row: SqlRow): PanelUser {
    return {
      id: asString(row.id),
      username: asString(row.username),
      email: asNullableString(row.email),
      passwordHash: asString(row.password_hash),
      // El CHECK de la tabla garantiza el dominio.
      role: asString(row.role) as UserRole,
      status: asString(row.status) as UserStatus,
      resellerProfileId: asNullableString(row.reseller_profile_id),
      routerIds: asJson<string[]>(row.router_ids, []),
      lastLoginAt: asNullableString(row.last_login_at),
      mustChangePassword: asBoolean(row.must_change_password),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      deletedAt: asNullableString(row.deleted_at),
    };
  }

  /** Busqueda por usuario (excluye borrados). Case-sensitive, como el UNIQUE. */
  public findByUsername(username: string): PanelUser | null {
    return this.selectOne(this.scope(cond('username = ?', username)));
  }

  /** Registra el ultimo acceso correcto. */
  public markLogin(id: UUID, at: string = this.nowIso()): void {
    this.touch(id, { last_login_at: at });
  }

  /** Cambia el hash y limpia el flag de cambio obligatorio. */
  public updatePassword(id: UUID, passwordHash: string, mustChange = false): void {
    this.touch(id, {
      password_hash: passwordHash,
      must_change_password: this.bool(mustChange),
    });
  }

  /** Usuarios activos de un rol concreto (para notificaciones y permisos). */
  public findByRole(role: UserRole): PanelUser[] {
    return this.selectAll(
      this.scope(cond('role = ?', role), cond("status = 'active'")),
      'ORDER BY username ASC',
    );
  }
}

export const userRepository = new UserRepository();
