import type {
  AppError,
  HotspotActiveSession,
  HotspotHost,
  HotspotProfile,
  HotspotProfileInput,
  HotspotServer,
  HotspotUser,
  HotspotUserInput,
  HotspotUserQuery,
  Paginated,
  Result,
  UUID,
} from '@/types';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/core/constants';
import { invalidInput, internalError } from '@/core/errors';
import { hotspotCommands } from '@/core/mikrotik/commands/hotspot';
import {
  parseRosDuration,
  toHotspotActiveSession,
  toHotspotHost,
  toHotspotProfile,
  toHotspotServer,
  toHotspotUser,
} from '@/core/mikrotik/parsers';

import { createRosExecutor, type RosExecutor } from './ros-exec';

/**
 * Casos de uso sobre el hotspot del router.
 *
 * A diferencia del CRUD de routers (que persiste en SQLite), aqui el estado
 * vive **en el equipo**: cada lectura es una consulta real y cada escritura un
 * comando real. Consecuencias que condicionan el diseno:
 *
 *  - El listado de usuarios se pagina **en memoria** tras leerlo del router:
 *    RouterOS no ofrece paginacion en `print`, solo filtros de consulta.
 *  - `status` no existe en RouterOS; se deduce de los contadores y de las
 *    sesiones abiertas (`/ip/hotspot/active`).
 *  - Un duplicado se comprueba ANTES de escribir, para responder con un 422
 *    entendible en vez de propagar el `!trap` del equipo como un 502.
 */

const MAX_NAME_LENGTH = 64;
const MAX_COMMENT_LENGTH = 255;
const MAX_RATE_LIMIT_LENGTH = 64;

/** `1M/1M`, `512k/512k`, `1M/1M 2M/2M` (grupos de burst separados por espacio). */
const RATE_LIMIT_PATTERN = /^\d+(?:\.\d+)?[kKmMgG]?\/\d+(?:\.\d+)?[kKmMgG]?$/;

export interface HotspotServiceDeps {
  /** Ejecutor ya construido; en produccion se usa el singleton. */
  readonly executor?: RosExecutor;
}

export interface HotspotService {
  /* Servers */
  listServers(routerId: UUID): Promise<Result<readonly HotspotServer[]>>;

  /* Perfiles */
  listProfiles(routerId: UUID): Promise<Result<readonly HotspotProfile[]>>;
  createProfile(routerId: UUID, input: HotspotProfileInput): Promise<Result<HotspotProfile>>;
  removeProfile(routerId: UUID, id: string): Promise<Result<void>>;

  /* Usuarios */
  listUsers(query: HotspotUserQuery): Promise<Result<Paginated<HotspotUser>>>;
  createUser(input: HotspotUserInput): Promise<Result<HotspotUser>>;
  removeUser(routerId: UUID, id: string): Promise<Result<void>>;

  /* Sesiones y hosts */
  listActiveSessions(routerId: UUID): Promise<Result<readonly HotspotActiveSession[]>>;
  disconnectSession(routerId: UUID, id: string): Promise<Result<void>>;
  listHosts(routerId: UUID): Promise<Result<readonly HotspotHost[]>>;
}

/* ── Utilidades del canal `Result` ───────────────────────────────────────── */

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(error: AppError): Result<T> {
  return { ok: false, error };
}

/* ── Validacion ──────────────────────────────────────────────────────────── */

function validateText(
  value: string,
  field: string,
  maxLength: number,
  { required = true }: { readonly required?: boolean } = {},
): AppError | null {
  const trimmed = value.trim();

  if (trimmed === '') {
    return required ? invalidInput(`${field} es obligatorio.`) : null;
  }
  if (trimmed.length > maxLength) {
    return invalidInput(`${field} no puede superar ${maxLength} caracteres.`);
  }

  return null;
}

/** Rate-limit de RouterOS (`1M/1M`). Un valor vacio lo desactiva. */
function validateRateLimit(value: string | null): AppError | null {
  if (value === null) return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (trimmed.length > MAX_RATE_LIMIT_LENGTH) {
    return invalidInput(`El limite de velocidad no puede superar ${MAX_RATE_LIMIT_LENGTH} caracteres.`);
  }
  if (!RATE_LIMIT_PATTERN.test(trimmed)) {
    return invalidInput('El limite de velocidad debe tener la forma "1M/1M" (subida/bajada).');
  }

  return null;
}

/** Descarta las claves `undefined` para no enviar parametros vacios al router. */
function compact(
  values: Readonly<Record<string, string | number | boolean | null | undefined>>,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;

    params[key] = value;
  }

  return params;
}

function toProfileParams(input: HotspotProfileInput): Record<string, string | number | boolean> {
  return compact({
    'rate-limit': input.rateLimit?.trim(),
    'shared-users': input.sharedUsers,
    'session-timeout': input.sessionTimeout,
    'idle-timeout': input.idleTimeout,
    'address-pool': input.addressPool,
    'on-login': input.onLogin,
    'on-logout': input.onLogout,
    disabled: input.disabled,
  });
}

function toUserParams(input: HotspotUserInput): Record<string, string | number | boolean> {
  return compact({
    server: input.server,
    'limit-uptime': input.limitUptime,
    'limit-bytes-in': input.limitBytesIn,
    'limit-bytes-out': input.limitBytesOut,
    comment: input.comment,
    disabled: input.disabled,
  });
}

/* ── Ordenacion y paginacion en memoria ──────────────────────────────────── */

type UserSortKey = 'username' | 'profile' | 'status' | 'uptime' | 'bytesIn' | 'bytesOut';

/** Clave de orden validada; cualquier otra cae en `username`. */
function toSortKey(sortBy: string | undefined): UserSortKey {
  switch (sortBy) {
    case 'profile':
    case 'status':
    case 'uptime':
    case 'bytesIn':
    case 'bytesOut':
      return sortBy;
    default:
      return 'username';
  }
}

function compareUsers(left: HotspotUser, right: HotspotUser, key: UserSortKey): number {
  switch (key) {
    case 'uptime':
      // La duracion es texto (`1d2h`): ordenar la cadena daria un orden absurdo.
      return parseRosDuration(left.uptime) - parseRosDuration(right.uptime);
    case 'bytesIn':
      return left.bytesIn - right.bytesIn;
    case 'bytesOut':
      return left.bytesOut - right.bytesOut;
    case 'profile':
      return left.profile.localeCompare(right.profile);
    case 'status':
      return left.status.localeCompare(right.status);
    case 'username':
      return left.username.localeCompare(right.username);
  }
}

function paginate<T>(items: readonly T[], page: number, pageSize: number): Paginated<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    total,
    page: current,
    pageSize,
    totalPages,
    hasNext: current < totalPages,
    hasPrev: current > 1,
  };
}

/* ── Implementacion ──────────────────────────────────────────────────────── */

export function createHotspotService(deps: HotspotServiceDeps = {}): HotspotService {
  const executor = deps.executor ?? createRosExecutor();

  return {
    async listServers(routerId) {
      const found = executor.find(routerId);
      if (!found.ok) return found;

      const reply = await executor.execOn(found.value, hotspotCommands.listServers());

      return success(
        reply.items
          .map(toHotspotServer)
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
    },

    async listProfiles(routerId) {
      const found = executor.find(routerId);
      if (!found.ok) return found;

      const reply = await executor.execOn(found.value, hotspotCommands.listProfiles());

      return success(
        reply.items
          .map(toHotspotProfile)
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
    },

    async createProfile(routerId, input) {
      const problem =
        validateText(input.name, 'El nombre del perfil', MAX_NAME_LENGTH) ??
        validateRateLimit(input.rateLimit ?? null);
      if (problem !== null) return fail(problem);

      if (input.sharedUsers !== undefined && !Number.isInteger(input.sharedUsers)) {
        return fail(invalidInput('Los usuarios compartidos deben ser un entero.'));
      }
      if (input.sharedUsers !== undefined && input.sharedUsers < 1) {
        return fail(invalidInput('Los usuarios compartidos deben ser al menos 1.'));
      }

      const found = executor.find(routerId);
      if (!found.ok) return found;
      const router = found.value;
      const name = input.name.trim();

      const existing = await executor.execOn(router, hotspotCommands.findProfileByName(name));
      if (existing.items.length > 0) {
        return fail(invalidInput(`Ya existe un perfil llamado "${name}".`));
      }

      await executor.executeOn(
        router,
        hotspotCommands.addProfile(name, toProfileParams(input)),
      );

      // Se relee del equipo: la respuesta de `add` no describe el perfil creado
      // (y cualquier default que hubiese aplicado RouterOS queda reflejado).
      const created = await executor.execOn(router, hotspotCommands.findProfileByName(name));
      const profile = created.items[0];

      if (profile === undefined) {
        return fail(
          internalError(`El router acepto el perfil "${name}" pero no lo devolvio al leerlo.`),
        );
      }

      return success(toHotspotProfile(profile));
    },

    async removeProfile(routerId, id) {
      if (id.trim() === '') return fail(invalidInput('El perfil no esta identificado.'));

      const found = executor.find(routerId);
      if (!found.ok) return found;

      await executor.executeOn(found.value, hotspotCommands.removeProfile(id));

      return success(undefined);
    },

    async listUsers(query) {
      const found = executor.find(query.routerId);
      if (!found.ok) return found;
      const router = found.value;

      // Filtros que el equipo resuelve mejor que nosotros: se envian en la
      // consulta para no traer de mas cuando el operador ya acota.
      const filter: Record<string, string> = {};
      if (query.profile !== undefined && query.profile !== '') filter.profile = query.profile;
      if (query.server !== undefined && query.server !== '') filter.server = query.server;

      const [usersReply, activeReply] = await Promise.all([
        executor.execOn(router, hotspotCommands.listUsers(filter)),
        executor.execOn(router, hotspotCommands.listActive()),
      ]);

      // Un usuario con sesion abierta esta `active`, dato que solo vive aqui.
      const online = new Set(activeReply.items.map((item) => toHotspotActiveSession(item).user));

      const search = query.search?.trim().toLowerCase() ?? '';
      let users = usersReply.items
        .map((item) => toHotspotUser(item, online.has(item.name ?? '')))
        .filter((user) => (query.disabled === undefined ? true : user.disabled === query.disabled))
        .filter((user) => (query.status === undefined ? true : user.status === query.status));

      if (search !== '') {
        users = users.filter(
          (user) =>
            user.username.toLowerCase().includes(search) ||
            (user.comment?.toLowerCase().includes(search) ?? false),
        );
      }

      const sortKey = toSortKey(query.sortBy);
      const direction = query.sortDirection === 'desc' ? -1 : 1;
      users.sort((left, right) => compareUsers(left, right, sortKey) * direction);

      const pageSize = Math.min(Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

      return success(paginate(users, query.page ?? 1, pageSize));
    },

    async createUser(input) {
      const problem =
        validateText(input.username, 'El nombre de usuario', MAX_NAME_LENGTH) ??
        validateText(input.profile, 'El perfil', MAX_NAME_LENGTH) ??
        validateText(input.comment ?? '', 'El comentario', MAX_COMMENT_LENGTH, { required: false });
      if (problem !== null) return fail(problem);

      const found = executor.find(input.routerId);
      if (!found.ok) return found;
      const router = found.value;
      const username = input.username.trim();

      const existing = await executor.execOn(router, hotspotCommands.findUserByName(username));
      if (existing.items.length > 0) {
        return fail(invalidInput(`Ya existe un usuario llamado "${username}".`));
      }

      await executor.executeOn(
        router,
        hotspotCommands.addUser(
          username,
          input.password ?? '',
          input.profile.trim(),
          toUserParams(input),
        ),
      );

      const created = await executor.execOn(router, hotspotCommands.findUserByName(username));
      const user = created.items[0];

      if (user === undefined) {
        return fail(
          internalError(`El router acepto el usuario "${username}" pero no lo devolvio al leerlo.`),
        );
      }

      return success(toHotspotUser(user));
    },

    async removeUser(routerId, id) {
      if (id.trim() === '') return fail(invalidInput('El usuario no esta identificado.'));

      const found = executor.find(routerId);
      if (!found.ok) return found;

      await executor.executeOn(found.value, hotspotCommands.removeUser(id));

      return success(undefined);
    },

    async listActiveSessions(routerId) {
      const found = executor.find(routerId);
      if (!found.ok) return found;

      const reply = await executor.execOn(found.value, hotspotCommands.listActive());

      return success(
        reply.items
          .map(toHotspotActiveSession)
          .sort((left, right) => left.user.localeCompare(right.user)),
      );
    },

    async disconnectSession(routerId, id) {
      if (id.trim() === '') return fail(invalidInput('La sesion no esta identificada.'));

      const found = executor.find(routerId);
      if (!found.ok) return found;

      await executor.executeOn(found.value, hotspotCommands.disconnectSession(id));

      return success(undefined);
    },

    async listHosts(routerId) {
      const found = executor.find(routerId);
      if (!found.ok) return found;

      const reply = await executor.execOn(found.value, hotspotCommands.listHosts());

      return success(
        reply.items
          .map(toHotspotHost)
          .sort((left, right) => left.address.localeCompare(right.address)),
      );
    },
  };
}

export const hotspotService: HotspotService = createHotspotService();
