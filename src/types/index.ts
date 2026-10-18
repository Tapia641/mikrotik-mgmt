/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MikroTik Web Manager — Tipos globales
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Este modulo es 100% *type-only* (no emite codigo en runtime) y define el
 *  contrato compartido entre todas las capas:
 *
 *      app (UI + API routes)
 *          └── core/services      (casos de uso)
 *                 └── core/mikrotik  (wrapper RouterOS)  ──┐
 *                 └── database       (repositorios SQLite) ─┘
 *
 *  Reglas:
 *   1. La capa `app` NUNCA habla directo con RouterOS ni con SQL: solo con
 *      `core/services`, usando los tipos de este archivo.
 *   2. Las entidades persistidas extienden `Entity` (id + timestamps).
 *   3. Los valores que cruzan el borde HTTP usan `ApiResponse<T>`.
 *   4. Las constantes de runtime (arrays de valores) NO viven aqui: van en
 *      `src/core/constants.ts`. Aqui solo uniones de string literales.
 *
 *  Convencion de nombres:
 *   - Entidad persistida .......... sustantivo en singular  (`Router`, `Voucher`)
 *   - Payload de entrada .......... sufijo `Input`          (`RouterInput`)
 *   - Proyeccion publica .......... prefijo `Public`        (`PublicUser`)
 *   - Estado derivado ............. sufijo `Status`         (`RouterStatus`)
 *   - Filtros de busqueda ......... sufijo `Query`/`Filter` (`VoucherQuery`)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. PRIMITIVOS Y UTILIDADES GENERICAS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Identificador unico (UUID v4 en SQLite, `.id` de RouterOS en el router). */
export type UUID = string;

/** Fecha/hora serializada en formato ISO-8601 (`2026-10-17T14:30:00.000Z`). */
export type ISODateString = string;

/** Solo fecha en formato `YYYY-MM-DD` (util para reportes y agregaciones). */
export type DateOnlyString = string;

/** Representacion de duraciones RouterOS (`"1w2d3h4m5s"`). */
export type RosDuration = string;

/** Tasa de transferencia RouterOS (`"2M/2M"`, `"10M/5M"` upload/download). */
export type RosRateLimit = string;

export type Nullable<T> = T | null;
export type Maybe<T> = T | undefined;
export type Awaitable<T> = T | Promise<T>;
export type Primitive = string | number | boolean | null | undefined;

/**
 * Resultado explicito para la capa `core`. Evita `throw` para errores
 * *esperados* (router caido, credenciales invalidas) y reserva las excepciones
 * para bugs.
 */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface Timestamps {
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

/** Base de toda entidad persistida en SQLite. */
export interface Entity extends Timestamps {
  readonly id: UUID;
}

/** Entidades con borrado logico. */
export interface SoftDeletable {
  readonly deletedAt: Nullable<ISODateString>;
}

export type SortDirection = 'asc' | 'desc';

export interface PaginationParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly sortBy?: string;
  readonly sortDirection?: SortDirection;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

/** Rango temporal inclusivo `[from, to]`. */
export interface DateRange {
  readonly from: ISODateString;
  readonly to: ISODateString;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. ENTORNO Y CONFIGURACION DE LA APLICACION
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NodeEnv = 'development' | 'test' | 'production';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Espejo tipado de `.env` (validado en `src/lib/env.ts`). */
export interface AppEnv {
  readonly NODE_ENV: NodeEnv;
  readonly APP_NAME: string;
  readonly APP_URL: string;
  readonly DATABASE_FILE: string;
  readonly SESSION_SECRET: string;
  readonly SESSION_TTL_SECONDS: number;
  readonly ENCRYPTION_KEY: string;
  readonly MIKROTIK_API_PORT: number;
  readonly MIKROTIK_API_SSL_PORT: number;
  readonly MIKROTIK_DEFAULT_TIMEOUT_MS: number;
  readonly MIKROTIK_POOL_MAX_CONNECTIONS: number;
  readonly LOG_LEVEL: LogLevel;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. PROTOCOLO RouterOS (primitivas crudas del API)
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Un item del API RouterOS es un mapa plano palabra→valor (todo string). */
export type RosItem = Readonly<Record<string, string>>;

export type RosSentenceKind = 'command' | 'reply' | 'trap' | 'done' | 'fatal' | 'empty';

/** Palabras de una sentencia del protocolo (una por linea del socket). */
export interface RosSentence {
  readonly kind: RosSentenceKind;
  readonly words: readonly string[];
}

export type RosTrapSeverity = 'error' | 'warning' | 'info';

/** `!trap` / `!fatal` devuelto por RouterOS ante un comando invalido. */
export interface RosTrap {
  readonly message: string;
  readonly category?: number;
  readonly code?: number;
  readonly severity?: RosTrapSeverity;
}

/** Respuesta completa a un `write()`: items `!re` + estado final. */
export interface RosReply {
  readonly tag?: string;
  /** `true` si RouterOS emitio `!done`. */
  readonly done: boolean;
  readonly trap?: RosTrap;
  readonly fatal?: RosTrap;
  readonly items: readonly RosItem[];
}

/** Opciones de conexion al socket RouterOS. */
/** Puerto minimo del error RouterOS. La clase vive en `core/mikrotik`. */
export interface MikrotikFailure extends Error {
  readonly code: MikrotikErrorCode;
  readonly command?: string;
  readonly trap?: RosTrap;
  readonly isTransportError: boolean;
  readonly apiErrorCode: ApiErrorCode;
}

export interface RosConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly timeoutMs?: number;
  /** TLS (puerto 8729). `rejectUnauthorized=false` para certificados self-signed. */
  readonly tls?: {
    readonly enabled: boolean;
    readonly rejectUnauthorized: boolean;
  };
}

/** Comando a ejecutar: `path` + `params` de filtro/accion. */
export interface RosCommand {
  readonly path: string;
  readonly action?: 'add' | 'set' | 'remove' | 'print' | 'getall' | 'disable' | 'enable' | 'unset';
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  /** Solo lectura (`print`/`getall`). Un `false` marca comando mutante. */
  readonly readOnly?: boolean;
}

/**
 * Puerto (Ports & Adapters) del wrapper RouterOS. La implementacion concreta
 * vive en `src/core/mikrotik/client.ts` y es la UNICA pieza que conoce
 * `@fibercom/routeros-api`.
 */
export interface MikrotikClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /** Ejecuta un comando de lectura y devuelve los items (`!re`). */
  exec(command: RosCommand): Promise<RosReply>;
  /** Ejecuta un comando mutante (add/set/remove/disable/enable). */
  execute(command: RosCommand): Promise<RosReply>;
  /**
   * Stream incremental RouterOS (`listen`) para monitoreo en vivo.
   * Devuelve la funcion que cierra el stream; `onError` recibe traps y fallos
   * de transporte (un stream sin manejador de error quedaria silencioso).
   */
  stream(
    command: RosCommand,
    onItem: (item: RosItem) => void,
    onError?: (error: MikrotikFailure) => void,
  ): Promise<() => void>;
}

export type MikrotikErrorCode =
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'TLS_ERROR'
  | 'AUTH_FAILED'
  | 'PROTOCOL_ERROR'
  | 'TRAP'
  | 'FATAL'
  | 'UNKNOWN';

export interface MikrotikErrorShape {
  readonly code: MikrotikErrorCode;
  readonly message: string;
  readonly command?: string;
  readonly trap?: RosTrap;
  readonly cause?: unknown;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. ROUTER (dispositivo MikroTik gestionado) — entidad persistida
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RouterConnectionProtocol = 'api' | 'api-ssl' | 'rest';

export type RouterStatus = 'unknown' | 'connecting' | 'online' | 'offline' | 'unauthorized';

export type RouterBoardFamily = 'routerboard' | 'chr' | 'cloud-hosted' | 'unknown';

/** Entidad `routers` en SQLite. La contrasena vive cifrada (AES-256-GCM). */
export interface Router extends Entity, SoftDeletable {
  readonly name: string;
  readonly description: Nullable<string>;
  readonly host: string;
  readonly port: number;
  readonly protocol: RouterConnectionProtocol;
  readonly username: string;
  /** Payload cifrado en base64. Nunca la contrasena en claro. */
  readonly passwordEncrypted: string;
  /** Aceptar certificados TLS self-signed (puerto 8729). */
  readonly tlsInsecure: boolean;
  readonly timeoutMs: number;
  readonly timezone: string;
  /** Codigo ISO-4217 usado para precios de vouchers (`IDR`, `PEN`, `USD`...). */
  readonly currency: string;
  readonly isActive: boolean;
  readonly status: RouterStatus;
  readonly lastSeenAt: Nullable<ISODateString>;
  readonly lastError: Nullable<string>;
}

/** Payload de alta/edicion. `password` en claro SOLO en el borde HTTP. */
export interface RouterInput {
  readonly name: string;
  readonly description?: Nullable<string>;
  readonly host: string;
  readonly port: number;
  readonly protocol: RouterConnectionProtocol;
  readonly username: string;
  readonly password: string;
  readonly tlsInsecure?: boolean;
  readonly timeoutMs?: number;
  readonly timezone?: string;
  readonly currency?: string;
  readonly isActive?: boolean;
}

export type RouterUpdateInput = Partial<RouterInput>;

/** Proyeccion segura para enviar al cliente (sin material criptografico). */
export type PublicRouter = Omit<Router, 'passwordEncrypted'>;

export interface RouterQuery extends PaginationParams {
  readonly status?: RouterStatus;
  readonly search?: string;
  readonly isActive?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. TELEMETRIA Y ESTADO EN VIVO DEL ROUTER
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface RouterIdentity {
  readonly name: string;
  readonly architectureName?: string;
  readonly boardName?: string;
  readonly version?: string;
  readonly platform?: string;
  readonly uptime?: RosDuration;
}

/** `GET /system/resource`. */
export interface RouterResource {
  readonly uptime: RosDuration;
  readonly version: string;
  readonly boardName?: string;
  readonly architectureName?: string;
  readonly cpu: string;
  readonly cpuCount: string;
  readonly cpuFrequency: string;
  readonly cpuLoad: number;
  readonly freeMemory: number;
  readonly totalMemory: number;
  readonly freeHddSpace: number;
  readonly totalHddSpace: number;
  readonly badBlocks?: string;
}

/** `GET /system/health` (solo en boards con sensores). */
export interface RouterHealth {
  readonly voltage?: number;
  readonly temperature?: number;
  readonly cpuTemperature?: number;
  readonly boardTemperature?: number;
  readonly fanSpeed?: number;
  readonly powerConsumption?: number;
}

/** Configuracion de interfaz (no confundir con `InterfaceStat`). */
export interface RouterInterfaceConfig {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly mtu: number;
  readonly macAddress: Nullable<string>;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly comment: Nullable<string>;
}

/** Contadores de trafico de una interfaz, con tasa calculada. */
export interface InterfaceStat {
  readonly name: string;
  readonly type: string;
  readonly running: boolean;
  readonly disabled: boolean;
  readonly rxByte: number;
  readonly txByte: number;
  /** Delta calculado por el servicio de monitoreo (bits por segundo). */
  readonly rxRateBps: number;
  readonly txRateBps: number;
  readonly mtu?: number;
  readonly macAddress?: string;
}

export interface RouterAddress {
  readonly id: string;
  readonly address: string;
  readonly network: string;
  readonly interface: string;
  readonly disabled: boolean;
  readonly comment: Nullable<string>;
}

export interface RouterAddressPool {
  readonly id: string;
  readonly name: string;
  readonly ranges: string;
  readonly comment: Nullable<string>;
}

export interface RouterLogEntry {
  readonly id: string;
  readonly time: string;
  readonly topics: readonly string[];
  readonly message: string;
}

/** Fotografia coherente del router en un instante. */
export interface RouterSnapshot {
  readonly routerId: UUID;
  readonly capturedAt: ISODateString;
  readonly identity: RouterIdentity;
  readonly resource: RouterResource;
  readonly interfaces: readonly InterfaceStat[];
  readonly health: Nullable<RouterHealth>;
  readonly activeHotspotSessions: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. AUTENTICACION DEL PANEL (usuarios administradores)
 * ═══════════════════════════════════════════════════════════════════════════ */

export type UserRole =
  /** Control total, incluida gestion de otros administradores. */
  | 'owner'
  | 'admin'
  /** Opera vouchers/sesiones, sin tocar routers ni usuarios. */
  | 'operator'
  /** Vendedor: solo gestiona sus propios vouchers y ventas. */
  | 'reseller'
  /** Solo lectura (monitoreo). */
  | 'viewer';

export type UserStatus = 'active' | 'suspended' | 'pending';

/** Entidad `users` en SQLite. */
export interface PanelUser extends Entity, SoftDeletable {
  readonly username: string;
  readonly email: Nullable<string>;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  /** Perfil comercial cuando `role === 'reseller'`. */
  readonly resellerProfileId: Nullable<UUID>;
  /** Alcance de acceso: routers visibles para este usuario. Vacio = todos. */
  readonly routerIds: readonly UUID[];
  readonly lastLoginAt: Nullable<ISODateString>;
  readonly mustChangePassword: boolean;
}

export type PublicUser = Omit<PanelUser, 'passwordHash'>;

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

export interface PanelUserInput {
  readonly username: string;
  readonly password: string;
  readonly email?: Nullable<string>;
  readonly role: UserRole;
  readonly resellerProfileId?: Nullable<UUID>;
  readonly routerIds?: readonly UUID[];
}

/**
 * Permiso atomico del panel. La matriz rol→permiso (el MINIMO requerido) vive
 * en `core/auth/authz.ts`, que la declara con `satisfies Record<Permission, ...>`
 * para que anadir un permiso aqui sin asignarle rol no compile.
 */
export type Permission =
  | 'routers:read'
  | 'routers:write'
  | 'hotspot:read'
  | 'hotspot:write'
  | 'vouchers:read'
  | 'vouchers:write'
  | 'vouchers:sell'
  | 'reports:read'
  | 'users:manage'
  | 'settings:manage';

/** Datos de sesion embebidos en el token y expuestos a los Route Handlers. */
export interface SessionUser {
  readonly id: UUID;
  readonly username: string;
  readonly role: UserRole;
  readonly routerIds: readonly UUID[];
}

export interface Session {
  readonly id: UUID;
  readonly userId: UUID;
  readonly user: SessionUser;
  /** Epoch en segundos. */
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly userAgent?: string;
  readonly ip?: string;
}

/** Claims del JWT (firmado/verificado con `jose`). */
export interface SessionClaims {
  /** `sub` = id del usuario. */
  readonly sub: string;
  readonly role: UserRole;
  readonly routerIds: readonly string[];
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly jti: string;
}

export interface LoginResult {
  readonly user: PublicUser;
  readonly session: Session;
  /** Token a depositar en cookie httpOnly desde el Route Handler. */
  readonly token: string;
}

/**
 * Cuerpo de `POST /api/auth/login`: igual que `LoginResult` pero SIN el token.
 * El JWT viaja solo por la cookie httpOnly, nunca en el JSON.
 */
export type LoginPayload = Omit<LoginResult, 'token'>;

/** Cuerpo de `GET /api/auth/me`: quien soy y que puedo hacer. */
export interface CurrentSession {
  readonly user: SessionUser;
  readonly permissions: readonly Permission[];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. HOTSPOT (espejo de los menus `/ip/hotspot/*` de RouterOS)
 * ═══════════════════════════════════════════════════════════════════════════ */

export type HotspotLoginMode = 'http-chap' | 'http-pap' | 'https' | 'cookie' | 'mac' | 'trial' | 'unknown';

/** Ciclo de vida de un usuario hotspot en el router. */
export type HotspotUserStatus =
  | 'unused'
  | 'active'
  | 'used'
  | 'expired'
  | 'disabled'
  | 'unknown';

export interface HotspotServer {
  readonly id: string;
  readonly name: string;
  readonly interface: string;
  readonly profile: string;
  readonly addressPool: Nullable<string>;
  readonly disabled: boolean;
  readonly comment: Nullable<string>;
}

/** `/ip/hotspot/user/profile` — perfil de velocidad/tiempo del router. */
export interface HotspotProfile {
  readonly id: string;
  readonly name: string;
  readonly rateLimit: Nullable<RosRateLimit>;
  readonly sharedUsers: number;
  readonly sessionTimeout: Nullable<RosDuration>;
  readonly idleTimeout: Nullable<RosDuration>;
  readonly keepaliveTimeout: Nullable<RosDuration>;
  readonly addressPool: Nullable<string>;
  readonly onLogin: Nullable<string>;
  readonly onLogout: Nullable<string>;
  readonly macCookieTimeout: Nullable<RosDuration>;
  readonly addMacCookie: boolean;
  readonly transparentProxy: boolean;
  readonly disabled: boolean;
  readonly comment: Nullable<string>;
}

export interface HotspotProfileInput {
  readonly name: string;
  readonly rateLimit?: Nullable<RosRateLimit>;
  readonly sharedUsers?: number;
  readonly sessionTimeout?: Nullable<RosDuration>;
  readonly idleTimeout?: Nullable<RosDuration>;
  readonly addressPool?: Nullable<string>;
  readonly onLogin?: Nullable<string>;
  readonly onLogout?: Nullable<string>;
  readonly disabled?: boolean;
}

/** `/ip/hotspot/user` — credencial activa en el router. */
export interface HotspotUser {
  readonly id: string;
  readonly username: string;
  readonly password: Nullable<string>;
  readonly profile: string;
  readonly server: Nullable<string>;
  readonly limitUptime: Nullable<RosDuration>;
  /** `0` = ilimitado (bytes). */
  readonly limitBytesIn: number;
  readonly limitBytesOut: number;
  readonly uptime: RosDuration;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly comment: Nullable<string>;
  readonly disabled: boolean;
  readonly status: HotspotUserStatus;
  readonly expiresAt: Nullable<ISODateString>;
}

/** `/ip/hotspot/active` — sesion abierta ahora mismo. */
export interface HotspotActiveSession {
  readonly id: string;
  readonly user: string;
  readonly address: string;
  readonly macAddress: string;
  readonly uptime: RosDuration;
  readonly sessionTimeLeft: Nullable<RosDuration>;
  readonly idleTime: RosDuration;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly server: Nullable<string>;
  readonly loginBy: HotspotLoginMode;
  readonly radius: boolean;
}

/** `/ip/hotspot/host` — dispositivo visto por el hotspot. */
export interface HotspotHost {
  readonly id: string;
  readonly macAddress: string;
  readonly address: string;
  readonly toAddress: Nullable<string>;
  readonly server: Nullable<string>;
  readonly uptime: RosDuration;
  readonly idleTime: RosDuration;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly authorized: boolean;
  readonly comment: Nullable<string>;
}

export interface HotspotUserQuery extends PaginationParams {
  readonly routerId: UUID;
  readonly profile?: string;
  readonly server?: string;
  readonly status?: HotspotUserStatus;
  readonly search?: string;
  readonly disabled?: boolean;
}

export interface HotspotUserInput {
  readonly routerId: UUID;
  readonly username: string;
  readonly password?: Nullable<string>;
  readonly profile: string;
  readonly server?: Nullable<string>;
  readonly limitUptime?: Nullable<RosDuration>;
  readonly limitBytesIn?: number;
  readonly limitBytesOut?: number;
  readonly comment?: Nullable<string>;
  readonly disabled?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. VOUCHERS (nucleo de la inspiracion Mikhmon v3)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Como se compone el par usuario/contrasena impreso en el voucher:
 *  - `username-password` → codigo = usuario, password distinto (por defecto).
 *  - `username-only`     → codigo = usuario y password iguales.
 *  - `password-only`     → codigo = password; usuario compartido por lote.
 */
export type VoucherMode = 'username-password' | 'username-only' | 'password-only';

export type VoucherStatus =
  | 'available'
  | 'sold'
  | 'active'
  | 'used'
  | 'expired'
  | 'revoked';

export type VoucherCharset = 'lower' | 'upper' | 'mixed' | 'numeric' | 'alphanumeric' | 'custom';

/** Formato de impresion (plantillas Mikhmon). */
export type VoucherFormat = 'qr' | 'card' | 'thermal' | 'label' | 'a4-grid';

export type VoucherValidityUnit = 'minutes' | 'hours' | 'days' | 'months';

/** Entidad `vouchers` en SQLite. */
export interface Voucher extends Entity {
  readonly code: string;
  readonly password: Nullable<string>;
  readonly routerId: UUID;
  readonly profileName: string;
  /** Caducidad del voucher (`"30d"`, `"12h"`); `null` = sin caducidad. */
  readonly validity: Nullable<RosDuration>;
  readonly limitUptime: Nullable<RosDuration>;
  readonly limitBytesIn: number;
  readonly limitBytesOut: number;
  readonly price: number;
  readonly currency: string;
  readonly status: VoucherStatus;
  readonly batchId: Nullable<UUID>;
  readonly resellerId: Nullable<UUID>;
  readonly soldAt: Nullable<ISODateString>;
  readonly activatedAt: Nullable<ISODateString>;
  readonly expiresAt: Nullable<ISODateString>;
  readonly comment: Nullable<string>;
}

/** Solicitud de generacion de un lote (paso 1 del flujo de venta). */
export interface VoucherBatchRequest {
  readonly routerId: UUID;
  readonly profileName: string;
  readonly mode: VoucherMode;
  readonly quantity: number;
  readonly codeLength: number;
  readonly charset: VoucherCharset;
  readonly customCharset?: string;
  readonly prefix?: string;
  readonly passwordLength?: number;
  /** Lote completo usa un mismo usuario (solo en `password-only`). */
  readonly sharedUsername?: string;
  readonly validity: Nullable<RosDuration>;
  readonly limitUptime: Nullable<RosDuration>;
  readonly limitBytesIn?: number;
  readonly limitBytesOut?: number;
  readonly price: number;
  readonly resellerId?: UUID;
  readonly comment?: string;
}

/** Entidad `voucher_batches`: trazabilidad de cada generacion. */
export interface VoucherBatch extends Entity {
  readonly routerId: UUID;
  readonly profileName: string;
  readonly mode: VoucherMode;
  readonly quantity: number;
  readonly price: number;
  readonly request: VoucherBatchRequest;
  readonly voucherIds: readonly UUID[];
  readonly createdBy: Nullable<UUID>;
}

/** Resultado de aplicar un lote al router (puede ser parcial). */
export interface VoucherBatchResult {
  readonly batchId: UUID;
  readonly created: readonly Voucher[];
  readonly failed: readonly { readonly code: string; readonly reason: string }[];
  readonly totalRequested: number;
  readonly totalCreated: number;
}

export interface VoucherQuery extends PaginationParams {
  readonly routerId?: UUID;
  readonly batchId?: UUID;
  readonly resellerId?: UUID;
  readonly profileName?: string;
  readonly status?: VoucherStatus;
  readonly code?: string;
  readonly createdRange?: DateRange;
}

export interface VoucherQuerySummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<VoucherStatus, number>>;
  readonly totalValue: number;
  readonly currency: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. PERFILES COMERCIALES / REVENDEDORES (Mikhmon "User Profile")
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Paquete vendible: agrupa precio, validez, modo de voucher y el perfil
 * hotspot de RouterOS al que se mapea. Es la plantilla desde la que se
 * generan lotes.
 */
export interface ResellerProfile extends Entity, SoftDeletable {
  readonly name: string;
  readonly routerId: UUID;
  /** Costo para el reseller. */
  readonly price: number;
  /** Precio sugerido al cliente final. */
  readonly sellingPrice: Nullable<number>;
  readonly currency: string;
  readonly validity: Nullable<RosDuration>;
  readonly validityUnit: VoucherValidityUnit;
  /** Nombre del `HotspotProfile` de RouterOS destino. */
  readonly hotspotProfileName: string;
  readonly limitUptime: Nullable<RosDuration>;
  readonly limitBytesIn: number;
  readonly limitBytesOut: number;
  readonly mode: VoucherMode;
  readonly sharedUsers: number;
  readonly isActive: boolean;
}

export type ResellerProfileInput = Omit<ResellerProfile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. VENTAS, TRANSACCIONES Y REPORTES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type TransactionStatus = 'pending' | 'completed' | 'refunded' | 'void';

export type PaymentMethod = 'cash' | 'transfer' | 'qris' | 'ewallet' | 'other';

export interface Transaction extends Entity {
  readonly routerId: UUID;
  readonly voucherId: Nullable<UUID>;
  readonly voucherCode: Nullable<string>;
  readonly resellerId: Nullable<UUID>;
  readonly profileName: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: TransactionStatus;
  readonly paymentMethod: PaymentMethod;
  readonly soldAt: ISODateString;
  readonly note: Nullable<string>;
}

export interface SalesSummaryRow {
  readonly key: string;
  readonly label: string;
  readonly quantity: number;
  readonly revenue: number;
}

export interface SalesSummary {
  readonly range: DateRange;
  readonly currency: string;
  readonly totalVouchers: number;
  readonly totalRevenue: number;
  readonly totalCost: Nullable<number>;
  readonly byProfile: readonly SalesSummaryRow[];
  readonly byReseller: readonly SalesSummaryRow[];
  readonly byDay: readonly SalesSummaryRow[];
}

/** KPIs agregados para el dashboard. */
export interface DashboardMetrics {
  readonly capturedAt: ISODateString;
  readonly routerId: Nullable<UUID>;
  readonly totalRouters: number;
  readonly onlineRouters: number;
  readonly activeSessions: number;
  readonly vouchersAvailable: number;
  readonly vouchersSoldToday: number;
  readonly revenueToday: number;
  readonly revenueMonth: number;
  readonly currency: string;
  readonly cpuLoad: Nullable<number>;
  readonly uptime: Nullable<RosDuration>;
}

export interface VoucherPrintJob {
  readonly batchId: UUID;
  readonly format: VoucherFormat;
  readonly vouchers: readonly Voucher[];
  readonly qrDataUrls: readonly (string | null)[];
  readonly meta: {
    readonly company: string;
    readonly logoDataUri?: string;
    readonly footer?: string;
    readonly wifiName?: string;
  };
  readonly generatedAt: ISODateString;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 11. CONTRATO HTTP (Route Handlers ⇄ cliente)
 * ═══════════════════════════════════════════════════════════════════════════ */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ROUTER_UNREACHABLE'
  | 'ROUTER_AUTH_FAILED'
  | 'ROUTER_TIMEOUT'
  | 'ROUTER_COMMAND_FAILED'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED';

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  /** Codigo HTTP equivalente. */
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;
  /** Errores por campo (formularios) tras validacion con zod. */
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly requestId?: string;
}

export interface ApiMeta {
  readonly requestId: string;
  readonly durationMs?: number;
  readonly pagination?: Omit<Paginated<never>, 'items'>;
}

export type ApiSuccess<T> = { readonly ok: true; readonly data: T; readonly meta?: ApiMeta };
export type ApiFailure = { readonly ok: false; readonly error: ApiError };

/** Envoltorio unico de TODA respuesta JSON del panel. */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Contexto normalizado que recibe cada Route Handler. */
export interface ApiHandlerContext<TRouteParams = Readonly<Record<string, string>>, TBody = unknown> {
  readonly params: TRouteParams;
  readonly body: TBody;
  readonly query: URLSearchParams;
  readonly user: Nullable<SessionUser>;
  readonly requestId: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 12. MONITOREO EN TIEMPO REAL
 * ═══════════════════════════════════════════════════════════════════════════ */

export type MonitoringTopic =
  | 'resource'
  | 'interfaces'
  | 'hotspot-active'
  | 'health'
  | 'logs';

export interface MonitoringSubscription {
  readonly routerId: UUID;
  readonly intervalMs: number;
  readonly topics: readonly MonitoringTopic[];
}

export interface TrafficSample {
  readonly routerId: UUID;
  readonly interfaceName: string;
  readonly timestamp: ISODateString;
  readonly rxRateBps: number;
  readonly txRateBps: number;
}

/** Evento emitido por un canal SSE/WebSocket hacia el panel. */
export type StreamEvent<T> =
  | { readonly type: 'open' }
  | { readonly type: 'data'; readonly payload: T }
  | { readonly type: 'error'; readonly error: ApiError }
  | { readonly type: 'close'; readonly reason: string };

/* ═══════════════════════════════════════════════════════════════════════════
 * 13. LOGGING Y AUDITORIA
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: ISODateString;
  readonly scope?: string;
  readonly routerId?: UUID;
  readonly userId?: UUID;
  readonly requestId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.login_failed'
  | 'router.create'
  | 'router.update'
  | 'router.delete'
  | 'router.connect_test'
  | 'hotspot_user.create'
  | 'hotspot_user.update'
  | 'hotspot_user.remove'
  | 'hotspot_user.disconnect'
  | 'voucher.generate'
  | 'voucher.sell'
  | 'voucher.revoke'
  | 'profile.create'
  | 'profile.update'
  | 'profile.delete'
  | 'transaction.create';

/** Entidad `audit_log` — append-only. */
export interface AuditLogEntry extends Entity {
  readonly actorId: Nullable<UUID>;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId: Nullable<string>;
  readonly routerId: Nullable<UUID>;
  readonly ip: Nullable<string>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 14. ERRORES DE LA CAPA DE APLICACION
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Error base de dominio. `code` mapea a `ApiErrorCode` en el borde HTTP. */
export interface AppErrorShape {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/**
 * `AppError` ya materializado (clase concreta en `core/errors.ts`).
 * Es el tipo por defecto del canal `error` de `Result<T, E>`.
 */
export interface AppError extends AppErrorShape {
  readonly name: string;
}
