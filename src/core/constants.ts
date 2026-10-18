import type {
  ApiErrorCode,
  HotspotLoginMode,
  HotspotUserStatus,
  NodeEnv,
  PaymentMethod,
  RouterConnectionProtocol,
  RouterStatus,
  SortDirection,
  TransactionStatus,
  UserRole,
  UserStatus,
  VoucherFormat,
  VoucherMode,
  VoucherStatus,
} from '@/types';

/**
 * Constantes de runtime derivadas de los tipos de `@/types`.
 * El archivo de tipos es type-only; los valores viven aqui para poder
 * usar `import type` en todas las capas.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const satisfies readonly NodeEnv[];

export const USER_ROLES = [
  'owner',
  'admin',
  'operator',
  'reseller',
  'viewer',
] as const satisfies readonly UserRole[];

export const USER_STATUSES = [
  'active',
  'suspended',
  'pending',
] as const satisfies readonly UserStatus[];

export const ROUTER_PROTOCOLS = [
  'api',
  'api-ssl',
  'rest',
] as const satisfies readonly RouterConnectionProtocol[];

export const ROUTER_STATUSES = [
  'unknown',
  'connecting',
  'online',
  'offline',
  'unauthorized',
] as const satisfies readonly RouterStatus[];

export const HOTSPOT_USER_STATUSES = [
  'unused',
  'active',
  'used',
  'expired',
  'disabled',
  'unknown',
] as const satisfies readonly HotspotUserStatus[];

export const HOTSPOT_LOGIN_MODES = [
  'http-chap',
  'http-pap',
  'https',
  'cookie',
  'mac',
  'trial',
] as const satisfies readonly HotspotLoginMode[];

export const VOUCHER_MODES = [
  'username-password',
  'username-only',
  'password-only',
] as const satisfies readonly VoucherMode[];

export const VOUCHER_STATUSES = [
  'available',
  'sold',
  'active',
  'used',
  'expired',
  'revoked',
] as const satisfies readonly VoucherStatus[];

export const VOUCHER_FORMATS = [
  'qr',
  'card',
  'thermal',
  'label',
  'a4-grid',
] as const satisfies readonly VoucherFormat[];

export const TRANSACTION_STATUSES = [
  'pending',
  'completed',
  'refunded',
  'void',
] as const satisfies readonly TransactionStatus[];

export const PAYMENT_METHODS = [
  'cash',
  'transfer',
  'qris',
  'ewallet',
  'other',
] as const satisfies readonly PaymentMethod[];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const satisfies readonly SortDirection[];

/** Codigo HTTP canonico para cada codigo de error de la API. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  ROUTER_UNREACHABLE: 502,
  ROUTER_AUTH_FAILED: 502,
  ROUTER_TIMEOUT: 504,
  ROUTER_COMMAND_FAILED: 502,
  DATABASE_ERROR: 500,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
} as const;

/** Puertos por defecto del API RouterOS. */
export const ROS_DEFAULT_API_PORT = 8728;
export const ROS_DEFAULT_API_SSL_PORT = 8729;

/** Paths RouterOS usados con mas frecuencia. */
export const ROS_PATHS = {
  identity: '/system/identity',
  resource: '/system/resource',
  health: '/system/health',
  log: '/log',
  interfaces: '/interface',
  addresses: '/ip/address',
  pools: '/ip/pool',
  hotspotServer: '/ip/hotspot',
  hotspotProfile: '/ip/hotspot/user/profile',
  hotspotUser: '/ip/hotspot/user',
  hotspotActive: '/ip/hotspot/active',
  hotspotHost: '/ip/hotspot/host',
  monitorTraffic: '/interface/monitor-traffic',
} as const;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

/** Coste de bcrypt para hashes de contrasena del panel (2^12 iteraciones). */
export const BCRYPT_ROUNDS = 12;
