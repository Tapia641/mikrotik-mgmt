import type {
  ApiErrorCode,
  MikrotikErrorCode,
  MikrotikErrorShape,
  MikrotikFailure,
  RosTrap,
} from '@/types';

/**
 * Error de la capa RouterOS. Se usa tanto para fallos esperados (router caido,
 * credenciales invalidas, `!trap`) como para los inesperados.
 *
 * Modelo de error (una sola via): el adaptador SIEMPRE lanza `MikrotikError`
 * ante transporte, autenticacion o `!trap`. Asi los servicios tienen un unico
 * canal de error que traducir; `RosReply` solo describe respuestas exitosas.
 */
export class MikrotikError extends Error implements MikrotikFailure {
  public override readonly name = 'MikrotikError';

  public readonly code: MikrotikErrorCode;
  public readonly command?: string;
  public readonly trap?: RosTrap;

  constructor(shape: MikrotikErrorShape) {
    super(shape.message, { cause: shape.cause });
    this.code = shape.code;
    this.command = shape.command;
    this.trap = shape.trap;
  }

  /** `true` cuando el fallo es de transporte/autenticacion, no del comando. */
  public get isTransportError(): boolean {
    return (
      this.code === 'CONNECTION_REFUSED' ||
      this.code === 'CONNECTION_TIMEOUT' ||
      this.code === 'TLS_ERROR' ||
      this.code === 'AUTH_FAILED'
    );
  }

  /** Codigo de error HTTP equivalente (lo usa el borde de `src/app`). */
  public get apiErrorCode(): ApiErrorCode {
    return toApiErrorCode(this.code);
  }
}

export function isMikrotikError(value: unknown): value is MikrotikError {
  return value instanceof MikrotikError;
}

/* ── Clasificacion de fallos crudos ──────────────────────────────────────── */

/**
 * `errno` de `RosException` (`@fibercom/routeros-api`) → codigo de dominio.
 * La tabla es explicita a proposito: un errno desconocido NO se adivina.
 */
const ERRNOS: Readonly<Record<string, MikrotikErrorCode>> = {
  // Autenticacion
  CANTLOGIN: 'AUTH_FAILED',
  LOGINBLOCKED: 'AUTH_FAILED',
  APIFORBIDDEN: 'AUTH_FAILED',

  // Transporte
  SOCKTMOUT: 'CONNECTION_TIMEOUT',
  ETIMEDOUT: 'CONNECTION_TIMEOUT',
  ECONNREFUSED: 'CONNECTION_REFUSED',
  ECONNRESET: 'CONNECTION_REFUSED',
  ECONNABORTED: 'CONNECTION_REFUSED',
  EHOSTUNREACH: 'CONNECTION_REFUSED',
  ENETUNREACH: 'CONNECTION_REFUSED',
  EHOSTDOWN: 'CONNECTION_REFUSED',
  ENOTFOUND: 'CONNECTION_REFUSED',
  EAIAGAIN: 'CONNECTION_REFUSED',
  ENOTCONN: 'CONNECTION_REFUSED',
  EPIPE: 'CONNECTION_REFUSED',
  RETRYFAIL: 'CONNECTION_REFUSED',

  // TLS / protocolo
  EPROTO: 'TLS_ERROR',
  UNREGISTEREDTAG: 'PROTOCOL_ERROR',
  UNKNOWNREPLY: 'PROTOCOL_ERROR',
  ALRDYSTREAMING: 'PROTOCOL_ERROR',
  CANTWRTWHLSTRMG: 'PROTOCOL_ERROR',
  STREAMCLOSD: 'PROTOCOL_ERROR',
  ALRDYCLOSNG: 'PROTOCOL_ERROR',
  ALRDYCONNECTING: 'PROTOCOL_ERROR',

  // RouterOS
  TRAP: 'TRAP',
  REFNOTFND: 'TRAP',
  FATAL: 'FATAL',
};

/** Pistas textuales cuando no hay `errno` reconocible. */
const MESSAGE_PATTERNS: readonly (readonly [RegExp, MikrotikErrorCode])[] = [
  [/EPROTO|certificate|self[- ]signed|\bTLS\b|\bSSL\b|CERT_/i, 'TLS_ERROR'],
  [
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENOTFOUND|socket hang up|connection refused/i,
    'CONNECTION_REFUSED',
  ],
  [/ETIMEDOUT|SOCKTMOUT|timed? ?out|timeout/i, 'CONNECTION_TIMEOUT'],
  [/CANTLOGIN|invalid (username|password)|login failed|not logged in/i, 'AUTH_FAILED'],
];

/**
 * `errno` del SDK que son una ADIVINACION, no un hecho del protocolo.
 *
 * `@fibercom/routeros-api` marca CUALQUIER fallo de socket (puerto cerrado,
 * host inalcanzable, TLS roto) como `APIFORBIDDEN` y deja el codigo real
 * —`ECONNREFUSED`, `ETIMEDOUT`...— dentro del mensaje. Fiarse del `errno` aqui
 * convertiria "la API esta apagada" en "credenciales rechazadas", que es un
 * diagnostico equivocado y ademas marca el router como `unauthorized`.
 */
const GENERIC_ERRNOS: ReadonlySet<string> = new Set(['APIFORBIDDEN']);

function matchMessage(message: string): MikrotikErrorCode | null {
  for (const [pattern, code] of MESSAGE_PATTERNS) {
    if (pattern.test(message)) return code;
  }

  return null;
}

const DEFAULT_MESSAGES: Readonly<Record<MikrotikErrorCode, string>> = {
  CONNECTION_REFUSED: 'No se pudo establecer la conexion con el router.',
  CONNECTION_TIMEOUT: 'El router no respondio dentro del tiempo limite.',
  TLS_ERROR: 'Fallo el handshake TLS con el router (revisa el certificado).',
  AUTH_FAILED: 'El router rechazo las credenciales configuradas.',
  PROTOCOL_ERROR: 'Respuesta inesperada del protocolo RouterOS.',
  TRAP: 'El router devolvio un trap al ejecutar el comando.',
  FATAL: 'El router aborto la sesion (!fatal).',
  UNKNOWN: 'Error inesperado al comunicarse con el router.',
};

/** Errores de socket de Node que no traen `errno` textual propio. */
function readErrno(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const errno = (value as { errno?: unknown }).errno;
  return typeof errno === 'string' && errno.length > 0 ? errno : null;
}

function readMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return '';
}

/** Determina el codigo de dominio de un fallo crudo (sin lanzar). */
export function classifyMikrotikFailure(value: unknown): MikrotikErrorCode {
  if (isMikrotikError(value)) return value.code;

  const errno = readErrno(value)?.toUpperCase() ?? null;
  const message = readMessage(value);

  // Un errno ESPECIFICO del SDK es la mejor pista: no admite interpretacion.
  if (errno !== null && !GENERIC_ERRNOS.has(errno)) {
    const known = ERRNOS[errno];
    if (known) return known;
  }

  // Con un errno generico (o ninguno) manda el texto: ahi viaja el codigo real
  // del socket (`Code: ECONNREFUSED`), que es mas fiable que la etiqueta.
  const fromMessage = matchMessage(message);
  if (fromMessage !== null) return fromMessage;

  // Ultimo recurso: el errno generico del SDK (p. ej. APIFORBIDDEN → AUTH_FAILED).
  if (errno !== null) {
    const known = ERRNOS[errno];
    if (known) return known;
  }

  return 'UNKNOWN';
}

/** Traduce un error desconocido al contrato `MikrotikError`. */
export function toMikrotikError(value: unknown, command?: string): MikrotikError {
  if (isMikrotikError(value)) {
    if (command === undefined || value.command !== undefined) return value;
    return new MikrotikError({
      code: value.code,
      message: value.message,
      command,
      trap: value.trap,
      cause: value,
    });
  }

  const code = classifyMikrotikFailure(value);
  const raw = readMessage(value).trim();

  return new MikrotikError({
    code,
    message: raw.length > 0 ? raw : DEFAULT_MESSAGES[code],
    command,
    cause: value,
  });
}

/** Error a partir de un `!trap` ya normalizado. */
export function trapToMikrotikError(trap: RosTrap, command?: string): MikrotikError {
  return new MikrotikError({
    code: 'TRAP',
    message: trap.message,
    command,
    trap,
  });
}

/* ── Traduccion al contrato HTTP ─────────────────────────────────────────── */

const API_CODES: Readonly<Record<MikrotikErrorCode, ApiErrorCode>> = {
  CONNECTION_REFUSED: 'ROUTER_UNREACHABLE',
  CONNECTION_TIMEOUT: 'ROUTER_TIMEOUT',
  TLS_ERROR: 'ROUTER_UNREACHABLE',
  AUTH_FAILED: 'ROUTER_AUTH_FAILED',
  PROTOCOL_ERROR: 'ROUTER_COMMAND_FAILED',
  TRAP: 'ROUTER_COMMAND_FAILED',
  FATAL: 'ROUTER_COMMAND_FAILED',
  UNKNOWN: 'ROUTER_COMMAND_FAILED',
};

export function toApiErrorCode(code: MikrotikErrorCode): ApiErrorCode {
  return API_CODES[code];
}
