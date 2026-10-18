import type {
  HotspotActiveSession,
  HotspotHost,
  HotspotLoginMode,
  HotspotProfile,
  HotspotServer,
  HotspotUser,
  HotspotUserStatus,
  InterfaceStat,
  RosItem,
  RouterHealth,
  RouterIdentity,
  RouterResource,
} from '@/types';

import { HOTSPOT_LOGIN_MODES } from '@/core/constants';

/**
 * Traduccion de los items crudos de RouterOS (`RosItem`, todo strings) a los
 * tipos de dominio de `@/types`.
 *
 * Es la capa anticorrupcion del adaptador: mantiene `client.ts` (protocolo) y
 * `services/` (casos de uso) ajenos a las peculiaridades del wire format.
 *
 * Criterios:
 *  - RouterOS omite las claves `false`/vacias → un campo ausente es `undefined`,
 *    nunca el texto `"false"`.
 *  - Un valor no numerico donde se espera un numero se degrada a `0` en vez de
 *    producir `NaN` (que envenenaria los calculos de tasa).
 *  - Los campos obligatorios del contrato llevan un valor de reserva explicito.
 */

/** Valor textual de un item; `undefined` si falta o viene vacio. */
export function readRosString(item: RosItem, key: string): string | undefined {
  const value = item[key];

  return value === undefined || value === '' ? undefined : value;
}

/** RouterOS solo emite `"true"` para los booleanos verdaderos. */
export function readRosBoolean(item: RosItem, key: string): boolean {
  return item[key] === 'true';
}

/** Numero tolerante: ausencia o basura → `0`. */
export function readRosNumber(item: RosItem, key: string): number {
  const raw = item[key];
  if (raw === undefined) return 0;

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : 0;
}

/** Primer numero presente entre claves alternativas del mismo dato. */
function readFirstNumber(item: RosItem, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    if (readRosString(item, key) !== undefined) return readRosNumber(item, key);
  }

  return undefined;
}

/** `/system/identity`. */
export function toRouterIdentity(item: RosItem): RouterIdentity {
  const architectureName = readRosString(item, 'architecture-name');
  const boardName = readRosString(item, 'board-name');
  const version = readRosString(item, 'version');
  const platform = readRosString(item, 'platform');
  const uptime = readRosString(item, 'uptime');

  return {
    name: readRosString(item, 'name') ?? 'sin-nombre',
    ...(architectureName === undefined ? {} : { architectureName }),
    ...(boardName === undefined ? {} : { boardName }),
    ...(version === undefined ? {} : { version }),
    ...(platform === undefined ? {} : { platform }),
    ...(uptime === undefined ? {} : { uptime }),
  };
}

/** `/system/resource`. */
export function toRouterResource(item: RosItem): RouterResource {
  const boardName = readRosString(item, 'board-name');
  const architectureName = readRosString(item, 'architecture-name');
  const badBlocks = readRosString(item, 'bad-blocks');

  return {
    uptime: readRosString(item, 'uptime') ?? '0s',
    version: readRosString(item, 'version') ?? 'desconocida',
    ...(boardName === undefined ? {} : { boardName }),
    ...(architectureName === undefined ? {} : { architectureName }),
    cpu: readRosString(item, 'cpu') ?? 'desconocida',
    cpuCount: readRosString(item, 'cpu-count') ?? '0',
    cpuFrequency: readRosString(item, 'cpu-frequency') ?? '0',
    cpuLoad: readRosNumber(item, 'cpu-load'),
    freeMemory: readRosNumber(item, 'free-memory'),
    totalMemory: readRosNumber(item, 'total-memory'),
    freeHddSpace: readRosNumber(item, 'free-hdd-space'),
    totalHddSpace: readRosNumber(item, 'total-hdd-space'),
    ...(badBlocks === undefined ? {} : { badBlocks }),
  };
}

/**
 * `/system/health`. Solo los boards con sensores lo exponen; en los demas el
 * router responde con un trap y el llamador decide (aqui `null`).
 *
 * `fan1-speed` (v7) y `fan-speed` (v6) designan el mismo dato.
 */
export function toRouterHealth(item: RosItem): RouterHealth {
  const voltage = readFirstNumber(item, ['voltage']);
  const temperature = readFirstNumber(item, ['temperature']);
  const cpuTemperature = readFirstNumber(item, ['cpu-temperature']);
  const boardTemperature = readFirstNumber(item, ['board-temperature']);
  const fanSpeed = readFirstNumber(item, ['fan1-speed', 'fan-speed']);
  const powerConsumption = readFirstNumber(item, ['power-consumption']);

  return {
    ...(voltage === undefined ? {} : { voltage }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(cpuTemperature === undefined ? {} : { cpuTemperature }),
    ...(boardTemperature === undefined ? {} : { boardTemperature }),
    ...(fanSpeed === undefined ? {} : { fanSpeed }),
    ...(powerConsumption === undefined ? {} : { powerConsumption }),
  };
}

/** Contadores crudos de una interfaz, base del calculo de tasas. */
export interface InterfaceCounters {
  readonly rxByte: number;
  readonly txByte: number;
}

/** Extrae los contadores de trafico de un item de `/interface`. */
export function toInterfaceCounters(item: RosItem): InterfaceCounters {
  return {
    rxByte: readRosNumber(item, 'rx-byte'),
    txByte: readRosNumber(item, 'tx-byte'),
  };
}

/**
 * Tasa en bits por segundo entre dos lecturas del mismo contador.
 *
 * Un delta negativo significa que el contador se reinicio (reboot) o que la
 * lectura no es comparable: se devuelve `0` en lugar de un valor absurdo.
 */
export function computeRateBps(previous: number, current: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;

  const delta = current - previous;
  if (delta <= 0) return 0;

  return Math.round((delta * 8 * 1000) / elapsedMs);
}

/** Configuracion de una interfaz (sin contadores). */
export function toInterfaceConfig(item: RosItem): {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly mtu: number;
  readonly macAddress: string | null;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly comment: string | null;
} {
  return {
    id: readRosString(item, '.id') ?? readRosString(item, 'name') ?? '',
    name: readRosString(item, 'name') ?? '',
    type: readRosString(item, 'type') ?? 'unknown',
    mtu: readRosNumber(item, 'mtu'),
    macAddress: readRosString(item, 'mac-address') ?? null,
    disabled: readRosBoolean(item, 'disabled'),
    running: readRosBoolean(item, 'running'),
    comment: readRosString(item, 'comment') ?? null,
  };
}

/**
 * `InterfaceStat` con la tasa calculada contra la lectura anterior.
 * `previous` es `null` en la primera muestra (aun no hay intervalo medible).
 */
export function toInterfaceStat(
  item: RosItem,
  previous: InterfaceCounters | null,
  elapsedMs: number,
): InterfaceStat {
  const counters = toInterfaceCounters(item);
  const mtu = readRosString(item, 'mtu');
  const macAddress = readRosString(item, 'mac-address');

  return {
    name: readRosString(item, 'name') ?? '',
    type: readRosString(item, 'type') ?? 'unknown',
    running: readRosBoolean(item, 'running'),
    disabled: readRosBoolean(item, 'disabled'),
    rxByte: counters.rxByte,
    txByte: counters.txByte,
    rxRateBps: previous === null ? 0 : computeRateBps(previous.rxByte, counters.rxByte, elapsedMs),
    txRateBps: previous === null ? 0 : computeRateBps(previous.txByte, counters.txByte, elapsedMs),
    ...(mtu === undefined ? {} : { mtu: readRosNumber(item, 'mtu') }),
    ...(macAddress === undefined ? {} : { macAddress }),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * HOTSPOT
 *
 * RouterOS devuelve todo como texto; aqui se normaliza a los tipos de dominio.
 * Los bytes y las duraciones SIEMPRE se convierten a numero: la UI y los
 * informes operan con magnitudes, no con el formato de la consola.
 * ══════════════════════════════════════════════════════════════════════════ */

const DURATION_UNIT_SECONDS: Readonly<Record<string, number>> = {
  w: 604_800,
  d: 86_400,
  h: 3_600,
  m: 60,
  s: 1,
};

/** `"1d02:03:04"` (estilo reloj) con dias y semanas opcionales. */
const CLOCK_DURATION = /^(?:(\d+)w)?(?:(\d+)d)?(\d{1,2}):(\d{2}):(\d{2})$/;

/**
 * Duracion de RouterOS → segundos.
 *
 * Acepta las dos formas que emite el equipo:
 *  - compacta, en cualquier orden: `1w2d3h4m5s`, `3h20m`, `45s`;
 *  - reloj: `1d02:03:04`, `02:03:04`.
 *
 * Un numero desnudo se interpreta como segundos (es lo que hace la propia
 * consola: `limit-uptime=3600`). Texto irreconocible → `0`, nunca `NaN`.
 */
export function parseRosDuration(text: string | undefined): number {
  if (text === undefined) return 0;

  const trimmed = text.trim();
  if (trimmed === '') return 0;

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const clock = CLOCK_DURATION.exec(trimmed);
  if (clock !== null) {
    const [, weeks, days, hours, minutes, seconds] = clock;

    return (
      Number(weeks ?? 0) * 604_800 +
      Number(days ?? 0) * 86_400 +
      Number(hours ?? 0) * 3_600 +
      Number(minutes ?? 0) * 60 +
      Number(seconds ?? 0)
    );
  }

  let total = 0;
  let recognised = false;

  for (const match of trimmed.matchAll(/(\d+(?:\.\d+)?)([wdhms])/gi)) {
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    const factor = unit === undefined ? undefined : DURATION_UNIT_SECONDS[unit];

    if (factor === undefined || !Number.isFinite(amount)) continue;

    total += amount * factor;
    recognised = true;
  }

  return recognised ? Math.round(total) : 0;
}

/** Duracion numerica de un item; `0` si falta o no se reconoce. */
export function readRosDurationSeconds(item: RosItem, key: string): number {
  return parseRosDuration(readRosString(item, key));
}

/** RouterOS escribe el motivo de login como texto libre. */
function toLoginMode(raw: string | undefined): HotspotLoginMode {
  if (raw === undefined) return 'unknown';

  return (HOTSPOT_LOGIN_MODES as readonly string[]).includes(raw)
    ? (raw as HotspotLoginMode)
    : 'unknown';
}

/**
 * Estado de un usuario del hotspot.
 *
 * RouterOS **no** expone un campo `status`: se deduce de sus contadores. Un
 * usuario puede estar `active` solo si tiene una sesion abierta, dato que vive
 * en `/ip/hotspot/active`; por eso el servicio lo indica con `isOnline`.
 */
export function deriveUserStatus(item: RosItem, isOnline: boolean): HotspotUserStatus {
  if (readRosBoolean(item, 'disabled')) return 'disabled';
  if (isOnline) return 'active';

  const limitUptimeRaw = readRosString(item, 'limit-uptime');
  const limitUptime = parseRosDuration(limitUptimeRaw);

  // Consumio todo el tiempo contratado.
  if (limitUptimeRaw !== undefined && limitUptime > 0) {
    if (readRosDurationSeconds(item, 'uptime') >= limitUptime) return 'expired';
  }

  const consumido =
    readRosDurationSeconds(item, 'uptime') > 0 ||
    readRosNumber(item, 'bytes-in') > 0 ||
    readRosNumber(item, 'bytes-out') > 0;

  return consumido ? 'used' : 'unused';
}

/** `/ip/hotspot` — servidor hotspot. */
export function toHotspotServer(item: RosItem): HotspotServer {
  return {
    id: readRosString(item, '.id') ?? '',
    name: readRosString(item, 'name') ?? '',
    interface: readRosString(item, 'interface') ?? '',
    profile: readRosString(item, 'profile') ?? '',
    addressPool: readRosString(item, 'address-pool') ?? null,
    disabled: readRosBoolean(item, 'disabled'),
    comment: readRosString(item, 'comment') ?? null,
  };
}

/** `/ip/hotspot/user/profile`. */
export function toHotspotProfile(item: RosItem): HotspotProfile {
  return {
    id: readRosString(item, '.id') ?? '',
    name: readRosString(item, 'name') ?? '',
    rateLimit: readRosString(item, 'rate-limit') ?? null,
    sharedUsers: readRosNumber(item, 'shared-users'),
    sessionTimeout: readRosString(item, 'session-timeout') ?? null,
    idleTimeout: readRosString(item, 'idle-timeout') ?? null,
    keepaliveTimeout: readRosString(item, 'keepalive-timeout') ?? null,
    addressPool: readRosString(item, 'address-pool') ?? null,
    onLogin: readRosString(item, 'on-login') ?? null,
    onLogout: readRosString(item, 'on-logout') ?? null,
    macCookieTimeout: readRosString(item, 'mac-cookie-timeout') ?? null,
    addMacCookie: readRosBoolean(item, 'add-mac-cookie'),
    transparentProxy: readRosBoolean(item, 'transparent-proxy'),
    disabled: readRosBoolean(item, 'disabled'),
    comment: readRosString(item, 'comment') ?? null,
  };
}

/**
 * `/ip/hotspot/user`.
 *
 * `expiresAt` solo aparece si el equipo lo trae (v7 con `limit-uptime`); en un
 * hotspot clasico es `null` y la caducidad real la aporta el voucher local.
 */
export function toHotspotUser(item: RosItem, isOnline = false): HotspotUser {
  return {
    id: readRosString(item, '.id') ?? '',
    username: readRosString(item, 'name') ?? '',
    password: readRosString(item, 'password') ?? null,
    profile: readRosString(item, 'profile') ?? '',
    server: readRosString(item, 'server') ?? null,
    limitUptime: readRosString(item, 'limit-uptime') ?? null,
    limitBytesIn: readRosNumber(item, 'limit-bytes-in'),
    limitBytesOut: readRosNumber(item, 'limit-bytes-out'),
    uptime: readRosString(item, 'uptime') ?? '0s',
    bytesIn: readRosNumber(item, 'bytes-in'),
    bytesOut: readRosNumber(item, 'bytes-out'),
    comment: readRosString(item, 'comment') ?? null,
    disabled: readRosBoolean(item, 'disabled'),
    status: deriveUserStatus(item, isOnline),
    expiresAt: readRosString(item, 'expires-at') ?? null,
  };
}

/** `/ip/hotspot/active` — sesion abierta ahora mismo. */
export function toHotspotActiveSession(item: RosItem): HotspotActiveSession {
  return {
    id: readRosString(item, '.id') ?? '',
    user: readRosString(item, 'user') ?? '',
    address: readRosString(item, 'address') ?? '',
    macAddress: readRosString(item, 'mac-address') ?? '',
    uptime: readRosString(item, 'uptime') ?? '0s',
    sessionTimeLeft: readRosString(item, 'session-time-left') ?? null,
    idleTime: readRosString(item, 'idle-time') ?? '0s',
    bytesIn: readRosNumber(item, 'bytes-in'),
    bytesOut: readRosNumber(item, 'bytes-out'),
    server: readRosString(item, 'server') ?? null,
    loginBy: toLoginMode(readRosString(item, 'login-by')),
    radius: readRosBoolean(item, 'radius'),
  };
}

/** `/ip/hotspot/host` — dispositivo visto por el hotspot. */
export function toHotspotHost(item: RosItem): HotspotHost {
  return {
    id: readRosString(item, '.id') ?? '',
    macAddress: readRosString(item, 'mac-address') ?? '',
    address: readRosString(item, 'address') ?? '',
    toAddress: readRosString(item, 'to-address') ?? null,
    server: readRosString(item, 'server') ?? null,
    uptime: readRosString(item, 'uptime') ?? '0s',
    idleTime: readRosString(item, 'idle-time') ?? '0s',
    bytesIn: readRosNumber(item, 'bytes-in'),
    bytesOut: readRosNumber(item, 'bytes-out'),
    authorized: readRosBoolean(item, 'authorized'),
    comment: readRosString(item, 'comment') ?? null,
  };
}
