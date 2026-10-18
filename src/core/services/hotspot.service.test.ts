import { describe, expect, it } from 'vitest';

import type { MikrotikClient, Result, RosCommand, RosItem, RosReply, UUID } from '@/types';

import { MikrotikError } from '@/core/mikrotik/errors';
import { notFound } from '@/core/errors';
import { ConnectionPool } from '@/core/mikrotik/pool';
import { buildWords } from '@/core/mikrotik/client';
import { createTestDb } from '@/database/testing';

import { createHotspotService, type HotspotService } from './hotspot.service';

const ROUTER_ID = '11111111-2222-3333-4444-555555555555' as UUID;

interface Clock {
  now(): number;
}

function reply(items: readonly RosItem[] = []): RosReply {
  return { done: true, items };
}

class FakeRosBackend {
  public readonly calls: RosCommand[] = [];
  private readonly routes = new Map<string, (call: number) => RosReply>();
  private readonly counts = new Map<string, number>();

  public set(word: string, items: readonly RosItem[]): void {
    this.routes.set(word, () => reply(items));
  }

  public setSequence(word: string, sequence: readonly (readonly RosItem[])[]): void {
    this.routes.set(word, (call) => reply(sequence[Math.min(call, sequence.length - 1)] ?? []));
  }

  public fail(word: string, error: Error): void {
    this.routes.set(word, () => {
      throw error;
    });
  }

  public handle = (command: RosCommand): Promise<RosReply> => {
    this.calls.push(command);

    const word = buildWords(command).join(' ');
    const call = this.counts.get(word) ?? 0;
    this.counts.set(word, call + 1);

    const route = this.routes.get(word);
    if (route === undefined) {
      return Promise.reject(
        new MikrotikError({
          code: 'TRAP',
          message: `Ruta simulada no definida: ${word}`,
          command: word,
        }),
      );
    }

    try {
      return Promise.resolve(route(call));
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

class FakeRosClient implements MikrotikClient {
  private connected = false;

  public constructor(private readonly backend: FakeRosBackend) {}

  public async connect(): Promise<void> {
    this.connected = true;
  }
  public async disconnect(): Promise<void> {
    this.connected = false;
  }
  public isConnected(): boolean {
    return this.connected;
  }
  public async exec(command: RosCommand): Promise<RosReply> {
    return this.backend.handle(command);
  }
  public async execute(command: RosCommand): Promise<RosReply> {
    return this.backend.handle(command);
  }
  public async stream(): Promise<() => void> {
    return () => undefined;
  }
}

function harness() {
  const backend = new FakeRosBackend();
  const clock: Clock = { now: () => 1_700_000_000_000 };

  const pool = new ConnectionPool({
    createClient: (): MikrotikClient => new FakeRosClient(backend),
    now: () => clock.now(),
  });

  // El repositorio de routers necesita una fila para que `executor.find` funcione.
  const db = createTestDb();
  const routerRepository = {
    findById: () => ({
      id: ROUTER_ID,
      name: 'Router Demo',
      host: '10.0.0.1',
      port: 8728,
      protocol: 'api' as const,
      username: 'admin',
      passwordEncrypted: 'ignored',
      tlsInsecure: false,
      timeoutMs: 5_000,
      status: 'unknown' as const,
      lastSeenAt: null,
      lastError: null,
      comment: null,
      deletedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  };

  const service = createHotspotService({
    executor: {
      find: (id) =>
        id === ROUTER_ID
          ? { ok: true, value: routerRepository.findById() as never }
          : { ok: false, error: notFound('Router', id) },
      connectionOptions: () => ({} as never),
      acquire: async () => new FakeRosClient(backend),
      evict: async () => undefined,
      execOn: (router, command) => new FakeRosClient(backend).exec(command),
      executeOn: (router, command) => new FakeRosClient(backend).execute(command),
    },
  });

  return { backend, service };
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Se esperaba exito: ${result.error.message}`);

  return result.value;
}

function unwrapError<T>(result: Result<T>): { code: string; message: string } {
  if (result.ok) throw new Error('Se esperaba un fallo.');

  return { code: result.error.code, message: result.error.message };
}

describe('hotspot.service: perfiles', () => {
  it('listProfiles parsea y ordena', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/profile/print', [
      { '.id': '*2', name: '30d', 'rate-limit': '2M/2M', 'shared-users': '3' },
      { '.id': '*1', name: '1h' },
    ]);

    const profiles = unwrap(await service.listProfiles(ROUTER_ID));

    expect(profiles.map((p) => p.name)).toEqual(['1h', '30d']);
    expect(profiles[1]?.rateLimit).toBe('2M/2M');
    expect(profiles[1]?.sharedUsers).toBe(3);
  });

  it('createProfile rechaza nombre vacio', async () => {
    const { service } = harness();

    const error = unwrapError(await service.createProfile(ROUTER_ID, { name: '  ', profile: 'x' } as never));

    // HotspotProfileInput no lleva `profile`; el campo obligatorio es name.
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('createProfile detecta duplicado', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/profile/print ?name=1h', [{ '.id': '*1', name: '1h' }]);

    const error = unwrapError(
      await service.createProfile(ROUTER_ID, { name: '1h', rateLimit: null }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('Ya existe un perfil');
  });

  it('createProfile lee de vuelta el perfil creado', async () => {
    const { backend, service } = harness();
    backend.setSequence('/ip/hotspot/user/profile/print ?name=nuevo', [
      [],
      [{ '.id': '*9', name: 'nuevo' }],
    ]);
    backend.set('/ip/hotspot/user/profile/add =name=nuevo', []);

    const created = unwrap(await service.createProfile(ROUTER_ID, { name: 'nuevo', rateLimit: null }));

    expect(created.id).toBe('*9');
    expect(created.name).toBe('nuevo');
  });

  it('removeProfile rechaza id vacio', async () => {
    const { service } = harness();

    const error = unwrapError(await service.removeProfile(ROUTER_ID, '   '));

    expect(error.code).toBe('VALIDATION_ERROR');
  });
});

describe('hotspot.service: usuarios', () => {
  it('listUsers pagina, filtra por search y ordena', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/print', [
      { '.id': '*1', name: 'alice', profile: '1h', uptime: '10m' },
      { '.id': '*2', name: 'bob', profile: '30d', uptime: '0s', disabled: 'true' },
      { '.id': '*3', name: 'alicia', profile: '1h', 'bytes-in': '100' },
    ]);
    backend.set('/ip/hotspot/active/print', []);

    const page = unwrap(
      await service.listUsers({ routerId: ROUTER_ID, search: 'ali', page: 1, pageSize: 10 }),
    );

    expect(page.items.map((u) => u.username)).toEqual(['alice', 'alicia']);
    expect(page.total).toBe(2);
  });

  it('listUsers marca online y filtra por status', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/print', [
      { '.id': '*1', name: 'alice', profile: '1h' },
      { '.id': '*2', name: 'bob', profile: '1h' },
    ]);
    backend.set('/ip/hotspot/active/print', [{ user: 'alice' }]);

    const page = unwrap(
      await service.listUsers({ routerId: ROUTER_ID, status: 'active' }),
    );

    expect(page.items.map((u) => u.username)).toEqual(['alice']);
  });

  it('createUser detecta duplicado', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/print ?name=alice', [{ '.id': '*1', name: 'alice', profile: '1h' }]);

    const error = unwrapError(
      await service.createUser({ routerId: ROUTER_ID, username: 'alice', profile: '1h' }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('Ya existe un usuario');
  });

  it('createUser lee de vuelta el usuario', async () => {
    const { backend, service } = harness();
    backend.setSequence('/ip/hotspot/user/print ?name=nuevo', [
      [],
      [{ '.id': '*7', name: 'nuevo', profile: '1h' }],
    ]);
    backend.set('/ip/hotspot/user/add =name=nuevo =password=secret =profile=1h', []);

    const created = unwrap(
      await service.createUser({ routerId: ROUTER_ID, username: 'nuevo', profile: '1h', password: 'secret' }),
    );

    expect(created.id).toBe('*7');
    expect(created.username).toBe('nuevo');
  });

  it('removeUser rechaza id vacio', async () => {
    const { service } = harness();

    const error = unwrapError(await service.removeUser(ROUTER_ID, '   '));

    expect(error.code).toBe('VALIDATION_ERROR');
  });
});

describe('hotspot.service: sesiones, hosts y servidores', () => {
  it('listActiveSessions parsea sesiones', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/active/print', [
      { '.id': '*a1', user: 'alice', address: '10.0.0.2', 'mac-address': 'AA', 'bytes-in': '10', 'login-by': 'http-chap' },
    ]);

    const sessions = unwrap(await service.listActiveSessions(ROUTER_ID));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.user).toBe('alice');
    expect(sessions[0]?.bytesIn).toBe(10);
  });

  it('disconnectSession rechaza id vacio', async () => {
    const { service } = harness();

    const error = unwrapError(await service.disconnectSession(ROUTER_ID, '   '));

    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('listHosts ordena por direccion', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/host/print', [
      { '.id': '*h2', 'mac-address': 'BB', address: '10.0.0.5' },
      { '.id': '*h1', 'mac-address': 'AA', address: '10.0.0.2' },
    ]);

    const hosts = unwrap(await service.listHosts(ROUTER_ID));

    expect(hosts.map((h) => h.address)).toEqual(['10.0.0.2', '10.0.0.5']);
  });

  it('listServers parsea el servidor', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/print', [
      { '.id': '*s1', name: 'hotspot1', interface: 'bridge-lan', profile: 'default', 'address-pool': 'pool1' },
    ]);

    const servers = unwrap(await service.listServers(ROUTER_ID));

    expect(servers[0]?.name).toBe('hotspot1');
    expect(servers[0]?.addressPool).toBe('pool1');
  });

  it('un router inexistente devuelve NOT_FOUND', async () => {
    const { service } = harness();

    const error = unwrapError(await service.listProfiles('00000000-0000-0000-0000-000000000000' as UUID));

    expect(error.code).toBe('NOT_FOUND');
  });
});