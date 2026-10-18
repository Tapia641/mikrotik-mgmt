/**
 * Primitivas de autenticacion y autorizacion del panel.
 *
 *   password.ts   hash/verify (bcryptjs)
 *   token.ts      JWT de sesion (jose, HS256)
 *   denylist.ts   revocacion por `jti` (logout)
 *   authz.ts      RBAC puro (roles, permisos, alcance de routers)
 *
 * Regla: nada de esta carpeta importa `database` ni `services`; los servicios
 * de `core/services` la consumen.
 */
export { BCRYPT_MAX_BYTES, PasswordError, hashPassword, needsRehash, verifyPassword } from './password';
export {
  MIN_SECRET_LENGTH,
  SESSION_ALGORITHM,
  SESSION_COOKIE_NAME,
  SESSION_ISSUER,
  SessionTokenError,
  signSessionToken,
  verifySessionToken,
} from './token';
export type {
  SessionTokenFailure,
  SignSessionTokenInput,
  SignedSessionToken,
  VerifySessionTokenOptions,
} from './token';
export { SessionDenylist, getSessionDenylist, resetSessionDenylist } from './denylist';
export type { SessionDenylistOptions } from './denylist';
export {
  PERMISSIONS,
  PERMISSION_NAMES,
  ROLE_RANK,
  can,
  canAccessRouter,
  hasRoleAtLeast,
  permissionsOf,
  scopeRouterIds,
  toPublicUser,
  toSessionUser,
} from './authz';
export type { Permission } from '@/types';
