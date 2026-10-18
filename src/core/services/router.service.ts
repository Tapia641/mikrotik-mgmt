import type {
  AppError,
  InterfaceStat,
  Paginated,
  PublicRouter,
  Result,
  Router,
  RouterInput,
  RouterQuery,
  RouterSnapshot,
  RouterStatus,
  RouterUpdateInput,
  UUID,
} from '@/types';

import { invalidInput, isDomainError } from '@/core/errors';
import { hotspotCommands } from '@/core/mikrotik/commands/hotspot';
import { systemCommands } from '@/core/mikrotik/commands/system';
import { isMikrotikError } from '@/core/mikrotik/errors';
import {
  toInterfaceCounters,
  toInterfaceStat,
  toRouterHealth,
  toRouterIdentity,
  toRouterResource,
  type InterfaceCounters,
} from '@/core/mikrotik/parsers';
import type { ConnectionPool } from '@/core/mikrotik/pool';
import { routerRepository, type RouterRepository } from '@/database/repositories';
import { encryptSecret } from '@/lib/crypto';
import { env } from '@/lib/env';

import { createRosExecutor, type RosExecutor } from './ros-exec';

/**
 * Casos de uso sobre dispositivos MikroTik.
 *
 * Responsabilidades:
 *  - cifrar/descifrar la password del router (AES-256-GCM, `lib/crypto`);
 *  - resolver la conexion del pool por `routerId` antes de tocar RouterOS;
 *  - persistir el resultado de cada prueba (`status`, `lastError`).
 *
 * Convenio de errores (igual que `authService`):
 *  - los desenlaces ESPERADOS viajan por el canal `Result` (`NOT_FOUND`,
 *    `VALIDATION_ERROR`, `CONFLICT`);
 *  - un fallo de INFRAESTRUCTURA (router inalcanzable, trap) se propaga como
 *    `MikrotikError`, que el borde HTTP ya traduce a 502/504 con su codigo.
 */

/** Ventana de muestreo de contadores para calcular tasas (ms). */
const TRAFFIC_SAMPLE_MS = 1_000;

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 60_000;
const MAX_NAME_LENGTH = 64;
const MAX_HOST_LENGTH = 255;

export interface RouterServiceDeps {
  readonly routers?: RouterRepository;
  readonly pool?: ConnectionPool;
  readonly encryptionKey?: string;
  /** Ejecutor ya construido (tests que inyectan un router falso). */
  readonly executor?: RosExecutor;
  /** Reloj inyectable en milisegundos (tests deterministas). */
  readonly now?: () => number;
  /** Espera inyectable (tests sin latencia real). */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly trafficSampleMs?: number;
}

export interface RouterService {
  list(query: RouterQuery): Promise<Result<Paginated<PublicRouter>>>;
  getById(id: UUID): Promise<Result<PublicRouter>>;
  create(input: RouterInput): Promise<Result<PublicRouter>>;
  update(id: UUID, input: RouterUpdateInput): Promise<Result<PublicRouter>>;
  remove(id: UUID): Promise<Result<void>>;
  /** Abre una conexion real al equipo y actualiza `status`/`lastSeenAt`. */
  testConnection(id: UUID): Promise<Result<{ latencyMs: number }>>;
  /** Fotografia de identidad + recursos + interfaces + sesiones hotspot. */
  getSnapshot(id: UUID): Promise<Result<RouterSnapshot>>;
  /** Monitoreo: contadores y tasa (bps) por interfaz en una ventana corta. */
  listInterfaces(id: UUID): Promise<Result<readonly InterfaceStat[]>>;
}

/* ── Utilidades del canal `Result` ───────────────────────────────────────── */

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(error: AppError): Result<T> {
  return { ok: false, error };
}

/** Proyeccion segura: el material cifrado nunca sale de esta capa. */
function toPublicRouter(router: Router): PublicRouter {
  return {
    id: router.id,
    name: router.name,
    description: router.description,
    host: router.host,
    port: router.port,
    protocol: router.protocol,
    username: router.username,
    tlsInsecure: router.tlsInsecure,
    timeoutMs: router.timeoutMs,
    timezone: router.timezone,
    currency: router.currency,
    isActive: router.isActive,
    status: router.status,
    lastSeenAt: router.lastSeenAt,
    lastError: router.lastError,
    createdAt: router.createdAt,
    updatedAt: router.updatedAt,
    deletedAt: router.deletedAt,
  };
}

/**
 * Estado derivado de un fallo de conexion.
 *
 * Un `TRAP`/`PROTOCOL_ERROR` significa que el equipo RESPONDIO (esta online)
 * aunque el comando fallase; solo los fallos de transporte lo dejan offline.
 */
export function statusFromFailure(cause: unknown): RouterStatus {
  if (!isMikrotikError(cause)) return 'unknown';
  if (cause.code === 'AUTH_FAILED') return 'unauthorized';

  return cause.isTransportError ? 'offline' : 'online';
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Error desconocido al conectar.';
}

/** Campos cuya modificacion invalida la conexion viva del pool. */
const CONNECTION_FIELDS: readonly (keyof RouterUpdateInput)[] = [
  'host',
  'port',
  'protocol',
  'username',
  'password',
  'tlsInsecure',
  'timeoutMs',
];

/* ── Validacion ──────────────────────────────────────────────────────────── */

interface ValidationOptions {
  /** En el alta la password es obligatoria; en la edicion es opcional. */
  readonly requirePassword: boolean;
}

function validate(input: RouterInput | RouterUpdateInput, options: ValidationOptions): AppError | null {
  const name = input.name?.trim();
  if (name !== undefined) {
    if (name === '') return invalidInput('El nombre del router es obligatorio.');
    if (name.length > MAX_NAME_LENGTH) {
      return invalidInput(`El nombre no puede superar ${MAX_NAME_LENGTH} caracteres.`);
    }
  }

  const host = input.host?.trim();
  if (host !== undefined) {
    if (host === '') return invalidInput('El host es obligatorio.');
    if (host.length > MAX_HOST_LENGTH) return invalidInput('El host es demasiado largo.');
    if (/\s/.test(host)) return invalidInput('El host no puede contener espacios.');
  }

  if (input.port !== undefined) {
    if (!Number.isInteger(input.port) || input.port < MIN_PORT || input.port > MAX_PORT) {
      return invalidInput(`El puerto debe ser un entero entre ${MIN_PORT} y ${MAX_PORT}.`);
    }
  }

  const username = input.username?.trim();
  if (username !== undefined && username === '') {
    return invalidInput('El usuario del router es obligatorio.');
  }

  if (input.password !== undefined && input.password === '') {
    return invalidInput('La contrasena del router no puede estar vacia.');
  }
  if (options.requirePassword && (input.password === undefined || input.password === '')) {
    return invalidInput('La contrasena del router es obligatoria.');
  }

  if (input.protocol === 'rest') {
    return invalidInput('El protocolo REST todavia no esta soportado; usa "api" o "api-ssl".');
  }

  if (input.timeoutMs !== undefined) {
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < MIN_TIMEOUT_MS) {
      return invalidInput(`El timeout debe ser un entero de al menos ${MIN_TIMEOUT_MS} ms.`);
    }
    if (input.timeoutMs > MAX_TIMEOUT_MS) {
      return invalidInput(`El timeout no puede superar ${MAX_TIMEOUT_MS} ms.`);
    }
  }

  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) {
    return invalidInput('La moneda debe ser un codigo ISO-4217 de 3 letras (p. ej. PEN, USD).');
  }

  return null;
}

/* ── Implementacion ──────────────────────────────────────────────────────── */

export function createRouterService(deps: RouterServiceDeps = {}): RouterService {
  const routers = deps.routers ?? routerRepository;
  const executor =
    deps.executor ??
    createRosExecutor({
      routers: deps.routers,
      pool: deps.pool,
      encryptionKey: deps.encryptionKey,
    });
  const encryptionKey = deps.encryptionKey ?? env.ENCRYPTION_KEY;
  const now = deps.now ?? ((): number => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const trafficSampleMs = deps.trafficSampleMs ?? TRAFFIC_SAMPLE_MS;

  const find = executor.find;
  const execOn = executor.execOn;

  return {
    async list(query) {
      const page = routers.search(query);

      return success({ ...page, items: page.items.map(toPublicRouter) });
    },

    async getById(id) {
      const result = find(id);

      return result.ok ? success(toPublicRouter(result.value)) : result;
    },

    async create(input) {
      const problem = validate(input, { requirePassword: true });
      if (problem !== null) return fail(problem);

      const name = input.name.trim();
      if (routers.findByName(name) !== null) {
        return fail(invalidInput(`Ya existe un router llamado "${name}".`));
      }

      const created = routers.create({
        name,
        description: input.description ?? null,
        host: input.host.trim(),
        port: input.port,
        protocol: input.protocol,
        username: input.username.trim(),
        passwordEncrypted: encryptSecret(input.password, encryptionKey),
        tlsInsecure: input.tlsInsecure ?? false,
        timeoutMs: input.timeoutMs ?? env.MIKROTIK_DEFAULT_TIMEOUT_MS,
        timezone: input.timezone ?? 'UTC',
        currency: input.currency ?? 'USD',
        isActive: input.isActive ?? true,
        status: 'unknown',
        lastSeenAt: null,
        lastError: null,
      });

      return success(toPublicRouter(created));
    },

    async update(id, input) {
      const found = find(id);
      if (!found.ok) return found;
      const current = found.value;

      const problem = validate(input, { requirePassword: false });
      if (problem !== null) return fail(problem);

      const name = input.name?.trim();
      if (name !== undefined && name !== current.name) {
        const clash = routers.findByName(name);
        if (clash !== null && clash.id !== id) {
          return fail(invalidInput(`Ya existe un router llamado "${name}".`));
        }
      }

      const patch: RouterUpdateInput = {
        ...(name === undefined ? {} : { name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.host === undefined ? {} : { host: input.host.trim() }),
        ...(input.port === undefined ? {} : { port: input.port }),
        ...(input.protocol === undefined ? {} : { protocol: input.protocol }),
        ...(input.username === undefined ? {} : { username: input.username.trim() }),
        ...(input.password === undefined
          ? {}
          : { password: input.password }),
        ...(input.tlsInsecure === undefined ? {} : { tlsInsecure: input.tlsInsecure }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...(input.currency === undefined ? {} : { currency: input.currency }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };

      // La password no es una columna: se persiste ya cifrada.
      const { password, ...columns } = patch;

      // Cambiar cualquier dato de conexion invalida el socket del pool: la
      // proxima operacion reconectara con los valores nuevos.
      if (CONNECTION_FIELDS.some((field) => patch[field] !== undefined)) {
        await executor.evict(id);
      }

      const updated = routers.update(id, {
        ...columns,
        ...(password === undefined ? {} : { passwordEncrypted: encryptSecret(password, encryptionKey) }),
      });

      return success(toPublicRouter(updated));
    },

    async remove(id) {
      const found = find(id);
      if (!found.ok) return found;

      await executor.evict(id);
      routers.delete(id);

      return success(undefined);
    },

    async testConnection(id) {
      const found = find(id);
      if (!found.ok) return found;
      const router = found.value;

      const started = now();

      try {
        await execOn(router, systemCommands.getIdentity());
      } catch (cause) {
        // El estado se persiste ANTES de propagar: el fallo es un dato del panel.
        if (isDomainError(cause)) return fail(cause);

        routers.updateStatus(id, statusFromFailure(cause), failureMessage(cause));
        throw cause;
      }

      const latencyMs = Math.max(0, now() - started);
      routers.updateStatus(id, 'online');

      return success({ latencyMs });
    },

    async getSnapshot(id) {
      const found = find(id);
      if (!found.ok) return found;
      const router = found.value;

      const client = await executor.acquire(router);

      const [identity, resource, interfaces, active] = await Promise.all([
        client.exec(systemCommands.getIdentity()),
        client.exec(systemCommands.getResource()),
        client.exec(systemCommands.listInterfaces()),
        client.exec(hotspotCommands.listActive()),
      ]);

      // No todos los boards tienen sensores: el trap es normal, no un fallo.
      const health = await client
        .exec(systemCommands.getHealth())
        .then((reply) => (reply.items[0] === undefined ? null : toRouterHealth(reply.items[0])))
        .catch(() => null);

      // Una sola muestra: sin intervalo previo no hay tasa calculable.
      const stats = interfaces.items.map((item) => toInterfaceStat(item, null, 0));

      return success({
        routerId: router.id,
        capturedAt: new Date(now()).toISOString(),
        identity: toRouterIdentity(identity.items[0] ?? {}),
        resource: toRouterResource(resource.items[0] ?? {}),
        interfaces: stats,
        health,
        activeHotspotSessions: active.items.length,
      });
    },

    async listInterfaces(id) {
      const found = find(id);
      if (!found.ok) return found;
      const router = found.value;

      const client = await executor.acquire(router);

      // La tasa se calcula sobre el intervalo REAL entre muestras: se toma el
      // reloj antes de la primera lectura, no antes de la segunda.
      const startedAt = now();
      const first = await client.exec(systemCommands.listInterfaces());

      await sleep(trafficSampleMs);

      const second = await client.exec(systemCommands.listInterfaces());
      const elapsedMs = Math.max(1, now() - startedAt);

      // Indexa la primera muestra por nombre para casar los contadores.
      const previous = new Map<string, InterfaceCounters>();
      for (const item of first.items) {
        const name = typeof item.name === 'string' ? item.name : '';
        if (name !== '') previous.set(name, toInterfaceCounters(item));
      }

      return success(
        second.items.map((item) => {
          const name = typeof item.name === 'string' ? item.name : '';

          return toInterfaceStat(item, previous.get(name) ?? null, elapsedMs);
        }),
      );
    },
  };
}

/** Instancia por defecto (singleton de la app). */
export const routerService: RouterService = createRouterService();
