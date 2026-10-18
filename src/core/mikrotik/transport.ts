import { MikrotikAPI } from '@fibercom/routeros-api';
import type { RStream } from '@fibercom/routeros-api';

import type { RosConnectionOptions, RosItem, RosTrap } from '@/types';

/**
 * Frontera con el socket RouterOS.
 *
 * `RosTransport` es la superficie MINIMA que el proyecto necesita del API
 * RouterOS (conectar, enviar una sentencia, escuchar un stream, cerrar). Todo
 * el protocolo (construccion de sentencias, clasificacion de errores, `RosReply`)
 * vive en `client.ts` y se prueba con un transporte falso.
 *
 * Esta es la unica pieza que conoce `@fibercom/routeros-api`: si algun dia se
 * migra a la REST API de RouterOS v7 basta con reimplementar este contrato.
 */

const MS_PER_SECOND = 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const CONNECT_ATTEMPTS = 2;
const CONNECT_RETRY_DELAY_MS = 400;

/** Manejadores de un comando continuo ya suscrito en el socket. */
export interface RosStreamHandle {
  onData(handler: (item: RosItem) => void): void;
  onTrap(handler: (trap: RosTrap) => void): void;
  onError(handler: (error: unknown) => void): void;
  close(): Promise<void>;
}

export interface RosTransport {
  connect(): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;
  /** Envia la sentencia; rechaza la promesa ante `!trap`/`!fatal` o fallo de socket. */
  send(words: readonly string[]): Promise<readonly RosItem[]>;
  /** Suscribe un comando continuo (`listen`/`monitor`). */
  listen(words: readonly string[]): RosStreamHandle;
}

export type RosTransportFactory = (options: RosConnectionOptions) => RosTransport;

/* ── Normalizacion de respuestas ─────────────────────────────────────────── */

/**
 * Un item RouterOS es un mapa plano palabra→valor. La libreria entrega `any`
 * por item; aqui se normaliza a `string` (el contrato `RosItem`) y se descartan
 * los valores nulos/compuestos.
 */
export function toRosItem(raw: unknown): RosItem {
  const item: Record<string, string> = {};
  if (typeof raw !== 'object' || raw === null) return item;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      item[key] = value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      item[key] = String(value);
    }
  }

  return item;
}

/** Convierte un `!trap` crudo en el contrato `RosTrap`. */
export function toRosTrap(raw: unknown): RosTrap {
  const item = toRosItem(raw);
  const trap: { message: string; category?: number; code?: number } = {
    message: item.message ?? 'RouterOS trap',
  };

  const category = Number.parseInt(item.category ?? '', 10);
  const code = Number.parseInt(item.code ?? '', 10);
  if (!Number.isNaN(category)) trap.category = category;
  if (!Number.isNaN(code)) trap.code = code;

  return trap;
}

/* ── Adaptador concreto ──────────────────────────────────────────────────── */

/** Implementacion real del transporte sobre `@fibercom/routeros-api`. */
export function createRouterOsTransport(options: RosConnectionOptions): RosTransport {
  // `IRosOptions.timeout` esta en SEGUNDOS; el dominio lo expresa en milisegundos.
  const timeoutSeconds = Math.max(
    1,
    Math.ceil((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / MS_PER_SECOND),
  );

  const api = new MikrotikAPI({
    host: options.host,
    user: options.username,
    password: options.password,
    port: options.port,
    timeout: timeoutSeconds,
    tls: options.tls?.enabled ? { rejectUnauthorized: options.tls.rejectUnauthorized } : false,
    debug: false,
  });

  return {
    async connect(): Promise<void> {
      await api.connectWithRetry(CONNECT_ATTEMPTS, CONNECT_RETRY_DELAY_MS);
    },

    async close(): Promise<void> {
      await api.close();
    },

    isConnected(): boolean {
      return api.connected === true;
    },

    async send(words: readonly string[]): Promise<readonly RosItem[]> {
      const items = await api.write([...words]);
      return items.map((raw) => toRosItem(raw));
    },

    listen(words: readonly string[]): RosStreamHandle {
      const stream: RStream = api.writeStream([...words]);

      return {
        onData(handler): void {
          stream.on('data', (packet: unknown) => {
            handler(toRosItem(packet));
          });
        },
        onTrap(handler): void {
          stream.on('trap', (packet: unknown) => {
            handler(toRosTrap(packet));
          });
        },
        onError(handler): void {
          // Un `EventEmitter` que emite `error` sin listener lanza: el cliente
          // SIEMPRE registra uno para que el fallo viaje por `onError`.
          stream.on('error', (error: unknown) => {
            handler(error);
          });
        },
        async close(): Promise<void> {
          await stream.stop();
        },
      };
    },
  };
}
