import type {
  MikrotikClient,
  MikrotikFailure,
  RosCommand,
  RosConnectionOptions,
  RosItem,
  RosReply,
} from '@/types';

import { MikrotikError, toMikrotikError, trapToMikrotikError } from './errors';
import { createRouterOsTransport } from './transport';
import type { RosTransport, RosTransportFactory } from './transport';

/**
 * Adaptador RouterOS. Es la UNICA pieza del proyecto que conoce
 * `@fibercom/routeros-api` (fork mantenido y tipado de node-routeros; y por
 * tanto la unica que se reemplaza si se migra a `routeros-client` o a la REST
 * API de RouterOS v7).
 *
 * Invariantes:
 *  - `exec()` NUNCA ejecuta un comando declarado mutante (`readOnly: false`).
 *    El camino de lectura no puede cambiar la configuracion del router.
 *  - Toda falla (socket, credenciales, `!trap`) sale como `MikrotikError`.
 *  - `connect()`/`disconnect()` son idempotentes.
 *
 * El transporte se inyecta (`RosTransportFactory`) para poder probar el
 * protocolo sin un router real.
 */
export class RouterOsClient implements MikrotikClient {
  private transport: RosTransport | null = null;

  public constructor(
    private readonly options: RosConnectionOptions,
    private readonly createTransport: RosTransportFactory = createRouterOsTransport,
  ) {}

  public getOptions(): RosConnectionOptions {
    return this.options;
  }

  public isConnected(): boolean {
    return this.transport?.isConnected() ?? false;
  }

  public async connect(): Promise<void> {
    if (this.transport) return;

    const transport = this.createTransport(this.options);
    try {
      await transport.connect();
    } catch (cause) {
      throw toMikrotikError(cause, 'connect');
    }

    this.transport = transport;
  }

  public async disconnect(): Promise<void> {
    const transport = this.transport;
    if (!transport) return;

    this.transport = null;
    try {
      await transport.close();
    } catch (cause) {
      throw toMikrotikError(cause, 'disconnect');
    }
  }

  public async exec(command: RosCommand): Promise<RosReply> {
    if (command.readOnly === false) {
      throw new MikrotikError({
        code: 'PROTOCOL_ERROR',
        message: `exec() rechaza comandos mutantes (${command.path}); usa execute().`,
        command: command.path,
      });
    }

    return this.run(command);
  }

  public async execute(command: RosCommand): Promise<RosReply> {
    return this.run(command);
  }

  public async stream(
    command: RosCommand,
    onItem: (item: RosItem) => void,
    onError?: (error: MikrotikFailure) => void,
  ): Promise<() => void> {
    const words = buildWords(command);
    const label = commandLabel(command, words);
    const transport = await this.ensureTransport(label);
    const handle = transport.listen(words);

    handle.onData(onItem);
    handle.onTrap((trap) => {
      onError?.(trapToMikrotikError(trap, label));
    });
    handle.onError((cause) => {
      onError?.(toMikrotikError(cause, label));
    });

    return async (): Promise<void> => {
      try {
        await handle.close();
      } catch (cause) {
        throw toMikrotikError(cause, label);
      }
    };
  }

  private async run(command: RosCommand): Promise<RosReply> {
    const words = buildWords(command);
    const label = commandLabel(command, words);
    const transport = await this.ensureTransport(label);

    try {
      const items = await transport.send(words);
      return { done: true, items };
    } catch (cause) {
      throw toMikrotikError(cause, label);
    }
  }

  private async ensureTransport(label: string): Promise<RosTransport> {
    const current = this.transport;
    if (current && current.isConnected()) return current;

    // Socket caido (p. ej. router reiniciado): se descarta y se reconecta.
    if (current) await this.disconnect();

    await this.connect();

    const transport = this.transport;
    if (!transport || !transport.isConnected()) {
      throw new MikrotikError({
        code: 'CONNECTION_REFUSED',
        message: 'La conexion RouterOS no esta disponible.',
        command: label,
      });
    }

    return transport;
  }
}

/* ── Construccion de sentencias ─────────────────────────────────────────── */

/**
 * Etiqueta legible del comando (`/ip/hotspot/user/print`) para mensajes de error
 * y auditoria. El transporte recibe la ruta por separado.
 */
function commandLabel(command: RosCommand, words: readonly string[]): string {
  return words[0] ?? command.path;
}

function renderParam(value: string | number | boolean): string {
  // RouterOS espera `yes`/`no` en las propiedades booleanas.
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * Traduce una `RosCommand` a las palabras del protocolo RouterOS:
 *
 *   `{ path: '/ip/hotspot/user', action: 'print', params: { name: 'x' } }`
 *     → `['/ip/hotspot/user/print', '?name=x']`
 *
 * Las propiedades que empiezan por `.` (`.id`, `.proplist`) son referencias de
 * campo y siempre viajan como asignacion (`=k=v`). En `print`/`getall` el resto
 * de parametros es filtro de consulta (`?k=v`); en cualquier otro comando
 * (incluido un stream sin `action`) son valores asignados (`=k=v`).
 */
export function buildWords(command: RosCommand): string[] {
  const path = command.action ? `${command.path}/${command.action}` : command.path;
  const words: string[] = [path];
  const isQueryAction = command.action === 'print' || command.action === 'getall';

  for (const [key, value] of Object.entries(command.params ?? {})) {
    const isQuery = isQueryAction && !key.startsWith('.');
    words.push(`${isQuery ? '?' : '='}${key}=${renderParam(value)}`);
  }

  return words;
}
