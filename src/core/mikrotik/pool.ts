import type { MikrotikClient, RosConnectionOptions } from '@/types';

import { RouterOsClient } from './client';

/**
 * Pool de conexiones RouterOS, una por router.
 *
 * El API clasico de RouterOS multiplexa comandos concurrentes sobre un unico
 * socket con tags (cada `write()` abre su propio canal), asi que una conexion
 * persistente por equipo es suficiente y evita el coste del login por comando.
 *
 * Responsabilidades:
 *  - reutilizar la conexion viva de un router (`acquire`),
 *  - reemplazarla si se cayo,
 *  - cerrar las ociosas pasado un TTL (`evictIdle`) para no dejar sockets
 *    abiertos en equipos que ya no se consultan.
 */

const DEFAULT_IDLE_TTL_MS = 60_000;

export interface ConnectionPoolOptions {
  /** Tiempo de inactividad tras el cual la conexion se cierra. */
  readonly idleTtlMs?: number;
  /** Reloj inyectable (tests deterministas). */
  readonly now?: () => number;
  /** Fabrica de clientes (tests con dobles). */
  readonly createClient?: (routerId: string, options: RosConnectionOptions) => MikrotikClient;
}

interface PoolEntry {
  readonly client: MikrotikClient;
  lastUsedAt: number;
}

export class ConnectionPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly idleTtlMs: number;
  private readonly now: () => number;
  private readonly createClient: (
    routerId: string,
    options: RosConnectionOptions,
  ) => MikrotikClient;

  public constructor(options: ConnectionPoolOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.now = options.now ?? ((): number => Date.now());
    this.createClient =
      options.createClient ?? ((_routerId, rosOptions): MikrotikClient => new RouterOsClient(rosOptions));
  }

  /** Conexiones actualmente registradas (vivas u ociosas). */
  public get size(): number {
    return this.entries.size;
  }

  /**
   * Devuelve un cliente conectado para `routerId`, creando la conexion si hace
   * falta. Si el cliente registrado ya no esta conectado, se descarta y se
   * reconecta (el router pudo reiniciarse).
   */
  public async acquire(routerId: string, options: RosConnectionOptions): Promise<MikrotikClient> {
    const existing = this.entries.get(routerId);
    if (existing) {
      if (existing.client.isConnected()) {
        existing.lastUsedAt = this.now();
        return existing.client;
      }
      await this.drop(routerId);
    }

    const client = this.createClient(routerId, options);
    try {
      await client.connect();
    } catch (cause) {
      await this.silentDisconnect(client);
      throw cause;
    }

    this.entries.set(routerId, { client, lastUsedAt: this.now() });
    return client;
  }

  /** Cliente ya conectado, sin abrir conexiones nuevas. `null` si no hay. */
  public peek(routerId: string): MikrotikClient | null {
    const entry = this.entries.get(routerId);
    if (!entry || !entry.client.isConnected()) return null;

    entry.lastUsedAt = this.now();
    return entry.client;
  }

  /** Cierra y descarta la conexion de un router. */
  public async evict(routerId: string): Promise<void> {
    await this.drop(routerId);
  }

  /** Cierra las conexiones ociosas mas alla del TTL. Devuelve cuantas cerro. */
  public async evictIdle(): Promise<number> {
    const deadline = this.now() - this.idleTtlMs;
    const stale = [...this.entries.entries()]
      .filter(([, entry]) => entry.lastUsedAt <= deadline)
      .map(([routerId]) => routerId);

    for (const routerId of stale) {
      await this.drop(routerId);
    }

    return stale.length;
  }

  /** Cierra todas las conexiones y vacia el pool (apagado ordenado). */
  public async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();

    for (const entry of entries) {
      await this.silentDisconnect(entry.client);
    }
  }

  private async drop(routerId: string): Promise<void> {
    const entry = this.entries.get(routerId);
    if (!entry) return;

    this.entries.delete(routerId);
    await this.silentDisconnect(entry.client);
  }

  /** Cerrar nunca debe tapar el error original de la operacion. */
  private async silentDisconnect(client: MikrotikClient): Promise<void> {
    try {
      await client.disconnect();
    } catch {
      // El socket ya estaba caido: nada que hacer.
    }
  }
}

/* ── Pool compartido por los servicios ───────────────────────────────────── */

let sharedPool: ConnectionPool | null = null;

export function getConnectionPool(): ConnectionPool {
  sharedPool ??= new ConnectionPool();
  return sharedPool;
}

/** Cierra y descarta el pool compartido (tests y apagado del proceso). */
export async function closeConnectionPool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = null;
  if (pool) await pool.closeAll();
}
