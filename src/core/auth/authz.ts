import type { PanelUser, Permission, PublicUser, SessionUser, UserRole } from '@/types';

/**
 * Reglas de autorizacion (RBAC). Modulo PURO: no toca base de datos, ni HTTP,
 * ni RouterOS, asi que se puede razonar y probar de forma aislada.
 *
 * Dos ejes independientes:
 *  - el ROL decide que operaciones puede hacer un usuario;
 *  - el ALCANCE (`routerIds`) decide sobre que routers. Una lista vacia
 *    significa "todos" (owner/admin/operator); un revendedor ve solo los suyos.
 */

/** Jerarquia de roles: mayor rango ⊇ permisos del menor. */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  owner: 50,
  admin: 40,
  operator: 30,
  reseller: 20,
  viewer: 10,
};

/** Operaciones del panel con el rol MINIMO que las habilita. */
export const PERMISSIONS = {
  'routers:read': 'viewer',
  'routers:write': 'admin',
  'hotspot:read': 'viewer',
  'hotspot:write': 'operator',
  'vouchers:read': 'viewer',
  'vouchers:write': 'operator',
  'vouchers:sell': 'reseller',
  'reports:read': 'reseller',
  'users:manage': 'admin',
  'settings:manage': 'owner',
} as const satisfies Readonly<Record<Permission, UserRole>>;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as readonly Permission[];

export function hasRoleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function can(role: UserRole, permission: Permission): boolean {
  return hasRoleAtLeast(role, PERMISSIONS[permission]);
}

/** Permisos efectivos de un rol (util para hidratar la UI). */
export function permissionsOf(role: UserRole): readonly Permission[] {
  return PERMISSION_NAMES.filter((permission) => can(role, permission));
}

/**
 * `true` si el usuario puede operar sobre ese router.
 * Lista vacia = sin restriccion de alcance.
 */
export function canAccessRouter(
  user: Pick<SessionUser, 'role' | 'routerIds'>,
  routerId: string,
): boolean {
  if (user.routerIds.length === 0) return true;
  return user.routerIds.includes(routerId);
}

/** Filtra una lista de routers segun el alcance del usuario. */
export function scopeRouterIds(
  user: Pick<SessionUser, 'role' | 'routerIds'>,
  routerIds: readonly string[],
): readonly string[] {
  if (user.routerIds.length === 0) return routerIds;
  return routerIds.filter((routerId) => user.routerIds.includes(routerId));
}

/** Proyeccion publica de un usuario: NUNCA incluye el hash de la contrasena. */
export function toPublicUser(user: PanelUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    resellerProfileId: user.resellerProfileId,
    routerIds: user.routerIds,
    lastLoginAt: user.lastLoginAt,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt,
  };
}

/** Datos de sesion derivados de la entidad persistida. */
export function toSessionUser(user: PanelUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    routerIds: user.routerIds,
  };
}
