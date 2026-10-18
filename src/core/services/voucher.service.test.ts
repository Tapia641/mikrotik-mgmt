import { describe, expect, it } from 'vitest';

import type { MikrotikClient, Result, RosCommand, RosItem, RosReply, UUID } from '@/types';

import { MikrotikError } from '@/core/mikrotik/errors';
import { notFound } from '@/core/errors';
import { ConnectionPool } from '@/core/mikrotik/pool';
import { buildWords } from '@/core/mikrotik/client';
import { createTestDb } from '@/database/testing';
import { VoucherRepository } from '@/database/repositories';

import { createVoucherService } from './voucher.service';

const ROUTER_ID = '11111111-2222-3333-4444-555555555555' as UUID;
const USER_ID = '22222222-3333-4444-5555-666666666666' as UUID;

class FakeRosBackend {
  public readonly calls: RosCommand[] = [];
  private readonly routes = new Map<string, (command: RosCommand) => RosReply>();

  public set(word: string, items: readonly RosItem[] = []): void {
    this.routes.set(word, () => ({ done: true, items }));
  }

  public fail(word: string, error: Error): void {
    this.routes.set(word, () => {
      throw error;
    });
  }

  public handle = (command: RosCommand): Promise<RosReply> => {
    this.calls.push(command);

    const word = buildWords(command)[0] ?? command.path;
    const route = this.routes.get(word);
    if (route === undefined) {
      return Promise.reject(
        new MikrotikError({ code: 'TRAP', message: `Ruta no definida: ${word}`, command: word }),
      );
    }

    try {
      return Promise.resolve(route(command));
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

class FakeRosClient implements MikrotikClient {
  private connected = false;

  public constructor(private readonly backend: FakeRosBackend) {}

  public async connect() { this.connected = true; }
  public async disconnect() { this.connected = false; }
  public isConnected() { return this.connected; }
  public async exec(command: RosCommand) { return this.backend.handle(command); }
  public async execute(command: RosCommand) { return this.backend.handle(command); }
  public async stream() { return () => undefined; }
}

function harness() {
  const db = createTestDb();
  // El FK de vouchers.router_id exige que el router exista.
  db.prepare(
    `INSERT INTO routers (id, name, host, port, protocol, username, password_encrypted, tls_insecure, timeout_ms, status, last_seen_at, last_error, deleted_at, created_at, updated_at, is_active, currency, timezone)
     VALUES (?, 'Router Demo', '10.0.0.1', 8728, 'api', 'admin', 'ignored', 0, 5000, 'unknown', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1, 'USD', 'UTC')`,
  ).run(ROUTER_ID);
  const vouchers = new VoucherRepository(db);
  const backend = new FakeRosBackend();
  const clock = { now: () => 1_700_000_000_000 };

  const pool = new ConnectionPool({
    createClient: (): MikrotikClient => new FakeRosClient(backend),
    now: () => clock.now(),
  });

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

  const service = createVoucherService({
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
    vouchers,
    now: () => clock.now(),
  });

  return { db, vouchers, backend, service };
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Se esperaba exito: ${result.error.message}`);
  return result.value;
}

function unwrapError<T>(result: Result<T>): { code: string; message: string } {
  if (result.ok) throw new Error('Se esperaba un fallo.');
  return { code: result.error.code, message: result.error.message };
}

describe('voucher.service: generateBatch', () => {
  it('genera el lote y persiste los vouchers', async () => {
    const { backend, service, vouchers } = harness();
    backend.set('/ip/hotspot/user/add', []);

    const result = unwrap(
      await service.generateBatch(
        {
          routerId: ROUTER_ID,
          profileName: '1h',
          mode: 'username-only',
          quantity: 3,
          codeLength: 4,
          charset: 'numeric',
          validity: null,
          limitUptime: null,
          price: 10,
        },
        null,
      ),
    );

    expect(result.totalCreated).toBe(3);
    expect(result.failed).toHaveLength(0);
    expect(result.created).toHaveLength(3);

    const listed = vouchers.search({});
    expect(listed.total).toBe(3);
    expect(listed.items[0]?.status).toBe('available');
  });

  it('un router inexistente devuelve NOT_FOUND', async () => {
    const { service } = harness();

    const error = unwrapError(
      await service.generateBatch(
        {
          routerId: '00000000-0000-0000-0000-000000000000' as UUID,
          profileName: '1h',
          mode: 'username-only',
          quantity: 1,
          codeLength: 4,
          charset: 'numeric',
          validity: null,
          limitUptime: null,
          price: 0,
        },
        null,
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
  });

  it('un fallo del router se registra en failed y no persiste ese voucher', async () => {
    const { backend, service, vouchers } = harness();
    // Primer addUser OK, segundo falla.
    let calls = 0;
    backend.set('/ip/hotspot/user/add', []);
    // Override: fail on the second call by re-registering a throwing handler after first.
    const originalHandle = backend.handle.bind(backend);
    let count = 0;
    backend.handle = (command) => {
      count += 1;
      if (count === 2) {
        return Promise.reject(new MikrotikError({ code: 'TRAP', message: 'trap', command: '/ip/hotspot/user/add' }));
      }
      return originalHandle(command);
    };

    const result = unwrap(
      await service.generateBatch(
        {
          routerId: ROUTER_ID,
          profileName: '1h',
          mode: 'username-only',
          quantity: 2,
          codeLength: 4,
          charset: 'numeric',
          validity: null,
          limitUptime: null,
          price: 0,
        },
        null,
      ),
    );

    expect(result.totalCreated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(vouchers.search({}).total).toBe(1);
  });
});

describe('voucher.service: list, summarize, sell, revoke', () => {
  it('list y summarize reflejan el inventario', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/add', []);

    unwrap(
      await service.generateBatch(
        {
          routerId: ROUTER_ID,
          profileName: '1h',
          mode: 'username-only',
          quantity: 2,
          codeLength: 4,
          charset: 'numeric',
          validity: null,
          limitUptime: null,
          price: 5,
        },
        null,
      ),
    );

    const list = unwrap(await service.list({ pageSize: 10 }));
    expect(list.total).toBe(2);

    const summary = unwrap(await service.summarize({}));
    expect(summary.total).toBe(2);
    expect(summary.byStatus.available).toBe(2);
  });

  it('sell marca el voucher como vendido', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/add', []);

    const batch = unwrap(
      await service.generateBatch(
        {
          routerId: ROUTER_ID,
          profileName: '1h',
          mode: 'username-only',
          quantity: 1,
          codeLength: 4,
          charset: 'numeric',
          validity: null,
          limitUptime: null,
          price: 5,
        },
        null,
      ),
    );

    const voucherId = batch.created[0]!.id;
    const sold = unwrap(await service.sell(voucherId, null));

    expect(sold.status).toBe('sold');
  });

  it('sell rechaza un voucher no disponible', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/add', []);

    const batch = unwrap(
      await service.generateBatch(
        {
          routerId: ROUTER_ID,
          profileName: '1h',
          mode: 'username-only',
          quantity: 1,
          codeLength: 4,
          charset: 'numeric',
          validity: null,
          limitUptime: null,
          price: 5,
        },
        null,
      ),
    );

    const voucherId = batch.created[0]!.id;
    unwrap(await service.sell(voucherId, null));

    const error = unwrapError(await service.sell(voucherId, null));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('revoke marca el voucher como revocado', async () => {
    const { backend, service } = harness();
    backend.set('/ip/hotspot/user/add', []);

    const batch = unwrap(
      await service.generateBatch(
        {
          routerId: ROUTER_ID,
          profileName: '1h',
          mode: 'username-only',
          quantity: 1,
          codeLength: 4,
          charset: 'numeric',
          validity: null,
          limitUptime: null,
          price: 5,
        },
        null,
      ),
    );

    const voucherId = batch.created[0]!.id;
    const revoked = unwrap(await service.revoke(voucherId));

    expect(revoked.status).toBe('revoked');
  });
});