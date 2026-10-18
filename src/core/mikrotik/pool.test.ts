import { describe, expect, it } from 'vitest';

import type { MikrotikClient, RosCommand, RosConnectionOptions, RosReply } from '@/types';

import { ConnectionPool } from './pool';

const OPTIONS: RosConnectionOptions = {
  host: '192.168.88.1',
  port: 8728,
  username: 'admin',
  password: 's3cret',
};

class FakeClient implements MikrotikClient {
  public connected = false;
  public connectCalls = 0;
  public disconnectCalls = 0;
  public connectError: unknown = null;

  public constructor(public readonly options: RosConnectionOptions) {}

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.connectError !== null) throw this.connectError;
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async exec(_command: RosCommand): Promise<RosReply> {
    return { done: true, items: [] };
  }

  public async execute(_command: RosCommand): Promise<RosReply> {
    return { done: true, items: [] };
  }

  public async stream(): Promise<() => void> {
    return async (): Promise<void> => undefined;
  }
}

/** El pool devuelve el puerto; en pruebas se necesita el doble con contadores. */
function fake(client: MikrotikClient): FakeClient {
  return client as FakeClient;
}

interface Harness {
  readonly pool: ConnectionPool;
  readonly created: FakeClient[];
  readonly ids: string[];
  advance(ms: number): void;
}

function harness(): Harness {
  const created: FakeClient[] = [];
  const ids: string[] = [];
  let clock = 1_000;

  const pool = new ConnectionPool({
    idleTtlMs: 10_000,
    now: () => clock,
    createClient: (routerId, options) => {
      ids.push(routerId);
      const client = new FakeClient(options);
      created.push(client);
      return client;
    },
  });

  return {
    pool,
    created,
    ids,
    advance: (ms) => {
      clock += ms;
    },
  };
}

describe('ConnectionPool', () => {
  it('empieza vacio', () => {
    expect(harness().pool.size).toBe(0);
  });

  it('crea y conecta un cliente por router', async () => {
    const h = harness();

    const client = await h.pool.acquire('router-a', OPTIONS);

    expect(client).toBe(h.created[0]);
    expect(h.created[0]?.connectCalls).toBe(1);
    expect(h.created[0]?.connected).toBe(true);
    expect(h.ids).toEqual(['router-a']);
    expect(h.pool.size).toBe(1);
  });

  it('reutiliza la conexion viva sin reconectar', async () => {
    const h = harness();

    const first = await h.pool.acquire('router-a', OPTIONS);
    const second = await h.pool.acquire('router-a', OPTIONS);

    expect(second).toBe(first);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]?.connectCalls).toBe(1);
  });

  it('reemplaza un cliente que perdio la conexion', async () => {
    const h = harness();

    const first = fake(await h.pool.acquire('router-a', OPTIONS));
    first.connected = false;

    const second = await h.pool.acquire('router-a', OPTIONS);

    expect(second).not.toBe(first);
    expect(first.disconnectCalls).toBe(1);
    expect(h.created).toHaveLength(2);
    expect(h.pool.size).toBe(1);
  });

  it('no deja rastro si la conexion falla', async () => {
    const failing = new FakeClient(OPTIONS);
    failing.connectError = new Error('ECONNREFUSED');

    const pool = new ConnectionPool({
      now: () => 0,
      createClient: () => failing,
    });

    await expect(pool.acquire('router-a', OPTIONS)).rejects.toThrow('ECONNREFUSED');
    expect(pool.size).toBe(0);
    expect(failing.disconnectCalls).toBe(1);
  });
});

describe('ConnectionPool.peek', () => {
  it('devuelve null sin abrir conexiones', () => {
    const h = harness();

    expect(h.pool.peek('router-a')).toBeNull();
    expect(h.created).toHaveLength(0);
  });

  it('devuelve el cliente conectado', async () => {
    const h = harness();
    const client = await h.pool.acquire('router-a', OPTIONS);

    expect(h.pool.peek('router-a')).toBe(client);
  });

  it('devuelve null si el cliente esta desconectado', async () => {
    const h = harness();
    const client = await h.pool.acquire('router-a', OPTIONS);
    await client.disconnect();

    expect(h.pool.peek('router-a')).toBeNull();
  });
});

describe('ConnectionPool.evict / evictIdle', () => {
  it('evict cierra y descarta la conexion', async () => {
    const h = harness();
    const client = fake(await h.pool.acquire('router-a', OPTIONS));

    await h.pool.evict('router-a');

    expect(client.disconnectCalls).toBe(1);
    expect(h.pool.size).toBe(0);
    expect(h.pool.peek('router-a')).toBeNull();
  });

  it('evict de un router desconocido no hace nada', async () => {
    const h = harness();

    await expect(h.pool.evict('router-x')).resolves.toBeUndefined();
    expect(h.pool.size).toBe(0);
  });

  it('evictIdle solo cierra las conexiones ociosas', async () => {
    const h = harness();
    const idle = fake(await h.pool.acquire('idle', OPTIONS));
    const busyLater = fake(await h.pool.acquire('busy', OPTIONS));

    h.advance(9_000);
    await h.pool.acquire('busy', OPTIONS); // refresca su marca de uso
    h.advance(2_000); // idle: 11s, busy: 2s

    expect(await h.pool.evictIdle()).toBe(1);
    expect(idle.disconnectCalls).toBe(1);
    expect(busyLater.disconnectCalls).toBe(0);
    expect(h.pool.size).toBe(1);
  });

  it('evictIdle no cierra nada si todo esta dentro del TTL', async () => {
    const h = harness();
    await h.pool.acquire('router-a', OPTIONS);

    h.advance(1_000);

    expect(await h.pool.evictIdle()).toBe(0);
    expect(h.pool.size).toBe(1);
  });
});

describe('ConnectionPool.closeAll', () => {
  it('cierra todo y deja el pool vacio', async () => {
    const h = harness();
    const first = fake(await h.pool.acquire('router-a', OPTIONS));
    const second = fake(await h.pool.acquire('router-b', OPTIONS));

    await h.pool.closeAll();

    expect(first.disconnectCalls).toBe(1);
    expect(second.disconnectCalls).toBe(1);
    expect(h.pool.size).toBe(0);
  });

  it('no falla si un cliente revienta al cerrar', async () => {
    const h = harness();
    const client = fake(await h.pool.acquire('router-a', OPTIONS));
    client.disconnect = async (): Promise<void> => {
      throw new Error('socket ya cerrado');
    };

    await expect(h.pool.closeAll()).resolves.toBeUndefined();
    expect(h.pool.size).toBe(0);
  });
});
