import { describe, expect, it } from 'vitest';

import type {
  MikrotikClient,
  Result,
  RosCommand,
  RosItem,
  RosReply,
  RouterStatus,
  RouterUpdateInput,
  UUID,
} from '@/types';

import { MikrotikError } from '@/core/mikrotik/errors';
import { ConnectionPool } from '@/core/mikrotik/pool';
import { RouterRepository } from '@/database/repositories';
import type { Db } from '@/database/db';
import { createTestDb } from '@/database/testing';
import { decryptSecret } from '@/lib/crypto';

import { createRouterService, statusFromFailure, type RouterService } from './router.service';

/**
 * El pool real con una fabrica de clientes falsa: así se ejercita de verdad la
 * logica de reutilizacion/desalojo y no un doble del pool.
 */

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const PLAIN_PASSWORD = 'sup3r-secreta';
const TRAFFIC_SAMPLE_MS = 1_000;

interface Clock {
  now(): number;
  advance(ms: number): void;
}

function createClock(start = 1_700_000_000_000): Clock {
  let current = start;

  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

function reply(items: readonly RosItem[] = []): RosReply {
  return { done: true, items };
}

/** Backend RouterOS simulado, enrutado por `command.path`. */
class FakeRosBackend {
  public readonly calls: RosCommand[] = [];
  public onCall: ((command: RosCommand) => void) | null = null;

  private readonly routes = new Map<string, (call: number) => RosReply>();
  private readonly counts = new Map<string, number>();

  public set(path: string, items: readonly RosItem[]): void {
    this.routes.set(path, () => reply(items));
  }

  /** Respuestas distintas por invocacion (util para muestrear contadores). */
  public setSequence(path: string, sequence: readonly (readonly RosItem[])[]): void {
    this.routes.set(path, (call) => reply(sequence[Math.min(call, sequence.length - 1)] ?? []));
  }

  public fail(path: string, error: Error): void {
    this.routes.set(path, () => {
      throw error;
    });
  }

  public handle = (command: RosCommand): Promise<RosReply> => {
    this.calls.push(command);
    this.onCall?.(command);

    const call = this.counts.get(command.path) ?? 0;
    this.counts.set(command.path, call + 1);

    const route = this.routes.get(command.path);
    if (route === undefined) {
      return Promise.reject(
        new MikrotikError({
          code: 'TRAP',
          message: `Ruta simulada no definida: ${command.path}`,
          command: command.path,
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

/** Cliente RouterOS falso: delega en el backend y respeta `isConnected`. */
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
    return this.exec(command);
  }

  public async stream(
    _command: RosCommand,
    onItem: (item: RosItem) => void,
  ): Promise<() => void> {
    onItem({});

    return () => undefined;
  }
}

interface Harness {
  readonly db: Db;
  readonly routers: RouterRepository;
  readonly backend: FakeRosBackend;
  readonly pool: ConnectionPool;
  readonly clock: Clock;
  readonly service: RouterService;
}

function harness(): Harness {
  const db = createTestDb();
  const routers = new RouterRepository(db);
  const backend = new FakeRosBackend();
  const clock = createClock();

  const pool = new ConnectionPool({
    createClient: (): MikrotikClient => new FakeRosClient(backend),
    now: () => clock.now(),
  });

  const service = createRouterService({
    routers,
    pool,
    encryptionKey: ENCRYPTION_KEY,
    now: () => clock.now(),
    // La espera avanza el reloj: el intervalo medido es determinista.
    sleep: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
    trafficSampleMs: TRAFFIC_SAMPLE_MS,
  });

  return { db, routers, backend, pool, clock, service };
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Se esperaba exito: ${result.error.message}`);

  return result.value;
}

function unwrapError<T>(result: Result<T>): { code: string; message: string } {
  if (result.ok) throw new Error('Se esperaba un fallo.');

  return { code: result.error.code, message: result.error.message };
}

interface RouterFixture {
  readonly name?: string;
  readonly host?: string;
  readonly protocol?: 'api' | 'api-ssl';
  readonly port?: number;
  readonly username?: string;
  readonly password?: string;
  readonly currency?: string;
}

async function createRouter(h: Harness, fixture: RouterFixture = {}): Promise<string> {
  const created = unwrap(
    await h.service.create({
      name: fixture.name ?? 'Router Demo',
      host: fixture.host ?? '192.168.88.1',
      port: fixture.port ?? 8728,
      protocol: fixture.protocol ?? 'api',
      username: fixture.username ?? 'admin',
      password: fixture.password ?? PLAIN_PASSWORD,
      ...(fixture.currency === undefined ? {} : { currency: fixture.currency }),
    }),
  );

  return created.id;
}

/** Registra la telemetria minima para que `getSnapshot` funcione. */
function registerTelemetry(h: Harness, overrides: { readonly sessions?: number } = {}): void {
  h.backend.set('/system/identity', [{ name: 'MikroTik-CCR', 'board-name': 'CCR2004' }]);
  h.backend.set('/system/resource', [{ uptime: '1d', version: '7.16.1', 'cpu-load': '5' }]);
  h.backend.set('/interface', [{ name: 'ether1', type: 'ether', running: 'true' }]);
  h.backend.set(
    '/ip/hotspot/active',
    Array.from({ length: overrides.sessions ?? 0 }, (_, index) => ({ '.id': `*${index}` })),
  );
}

describe('createRouterService.create', () => {
  it('cifra la password: nunca se guarda en claro', async () => {
    const h = harness();

    const id = await createRouter(h);
    const stored = h.routers.findById(id);

    expect(stored).not.toBeNull();
    expect(stored?.passwordEncrypted).not.toBe(PLAIN_PASSWORD);
    expect(stored?.passwordEncrypted).toMatch(/^v1:/);
    expect(decryptSecret(stored?.passwordEncrypted ?? '', ENCRYPTION_KEY)).toBe(PLAIN_PASSWORD);
  });

  it('la proyeccion publica no incluye el material cifrado', async () => {
    const h = harness();

    const created = unwrap(
      await h.service.create({
        name: 'Router Demo',
        host: '10.0.0.1',
        port: 8729,
        protocol: 'api-ssl',
        username: 'admin',
        password: PLAIN_PASSWORD,
      }),
    );

    expect(created).not.toHaveProperty('passwordEncrypted');
    expect(created.status).toBe('unknown');
    expect(created.lastSeenAt).toBeNull();
  });

  it('aplica los valores por defecto del panel', async () => {
    const h = harness();

    const created = unwrap(
      await h.service.create({
        name: 'Router Demo',
        host: '10.0.0.1',
        port: 8728,
        protocol: 'api',
        username: 'admin',
        password: PLAIN_PASSWORD,
      }),
    );

    expect(created.tlsInsecure).toBe(false);
    expect(created.isActive).toBe(true);
    expect(created.timezone).toBe('UTC');
    expect(created.currency).toBe('USD');
    expect(created.timeoutMs).toBeGreaterThan(0);
  });

  it('rechaza un nombre duplicado con NOT_FOUND/VALIDATION legible', async () => {
    const h = harness();
    await createRouter(h, { name: 'Oficina' });

    const error = unwrapError(await h.service.create({
      name: 'Oficina',
      host: '10.0.0.2',
      port: 8728,
      protocol: 'api',
      username: 'admin',
      password: PLAIN_PASSWORD,
    }));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('Oficina');
  });

  it('rechaza un host con espacios', async () => {
    const h = harness();

    const error = unwrapError(await h.service.create({
      name: 'Raro',
      host: '192.168.88.1 extra',
      port: 8728,
      protocol: 'api',
      username: 'admin',
      password: PLAIN_PASSWORD,
    }));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('espacios');
  });

  it('rechaza el protocolo REST (aun no soportado por el adaptador)', async () => {
    const h = harness();

    const error = unwrapError(await h.service.create({
      name: 'Rest',
      host: '10.0.0.3',
      port: 443,
      protocol: 'rest',
      username: 'admin',
      password: PLAIN_PASSWORD,
    }));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('REST');
  });

  it('valida puerto, timeout y moneda', async () => {
    const h = harness();
    const base = {
      name: 'Router Demo',
      host: '10.0.0.1',
      protocol: 'api' as const,
      username: 'admin',
      password: PLAIN_PASSWORD,
    };

    expect(unwrapError(await h.service.create({ ...base, port: 0 })).message).toContain('puerto');
    expect(unwrapError(await h.service.create({ ...base, port: 70_000 })).message).toContain('puerto');
    expect(unwrapError(await h.service.create({ ...base, port: 8728, timeoutMs: 10 })).message).toContain(
      'timeout',
    );
    expect(
      unwrapError(await h.service.create({ ...base, port: 8728, currency: 'soles' })).message,
    ).toContain('ISO-4217');
  });

  it('exige contrasena en el alta', async () => {
    const h = harness();

    const error = unwrapError(await h.service.create({
      name: 'Router Demo',
      host: '10.0.0.1',
      port: 8728,
      protocol: 'api',
      username: 'admin',
      password: '',
    }));

    expect(error.message).toContain('contrasena');
  });
});

describe('createRouterService.list', () => {
  it('pagina y filtra por texto sin exponer el material cifrado', async () => {
    const h = harness();
    await createRouter(h, { name: 'Oficina Norte', host: '10.0.0.1' });
    await createRouter(h, { name: 'Oficina Sur', host: '10.0.0.2' });
    await createRouter(h, { name: 'Almacen', host: '10.0.0.3' });

    const page = unwrap(await h.service.list({ search: 'Oficina', pageSize: 1 }));

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.totalPages).toBe(2);
    expect(page.hasNext).toBe(true);
    for (const item of page.items) {
      expect(item).not.toHaveProperty('passwordEncrypted');
    }
  });

  it('filtra por estado', async () => {
    const h = harness();
    const id = await createRouter(h);
    h.routers.updateStatus(id, 'offline', 'sin ruta');

    const online = unwrap(await h.service.list({ status: 'online' }));
    const offline = unwrap(await h.service.list({ status: 'offline' }));

    expect(online.total).toBe(0);
    expect(offline.total).toBe(1);
  });

  it('un router borrado no aparece en el listado', async () => {
    const h = harness();
    const id = await createRouter(h);

    unwrap(await h.service.remove(id));

    expect(unwrap(await h.service.list({})).total).toBe(0);
  });
});

describe('createRouterService.getById', () => {
  it('devuelve el router existente', async () => {
    const h = harness();
    const id = await createRouter(h, { name: 'Oficina' });

    expect(unwrap(await h.service.getById(id)).name).toBe('Oficina');
  });

  it('NOT_FOUND si no existe o esta borrado', async () => {
    const h = harness();
    const id = await createRouter(h);
    unwrap(await h.service.remove(id));

    expect(unwrapError(await h.service.getById(id)).code).toBe('NOT_FOUND');
    expect(unwrapError(await h.service.getById('00000000-0000-4000-8000-000000000000' as UUID)).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('createRouterService.update', () => {
  it('actualiza campos parciales sin tocar la password guardada', async () => {
    const h = harness();
    const id = await createRouter(h);
    const before = h.routers.findById(id)?.passwordEncrypted;

    const updated = unwrap(await h.service.update(id, { name: 'Renombrado', isActive: false }));

    expect(updated.name).toBe('Renombrado');
    expect(updated.isActive).toBe(false);
    expect(h.routers.findById(id)?.passwordEncrypted).toBe(before);
  });

  it('re-cifra la password solo cuando viene en el parche', async () => {
    const h = harness();
    const id = await createRouter(h);
    const before = h.routers.findById(id)?.passwordEncrypted;

    unwrap(await h.service.update(id, { password: 'otra-contrasena' }));

    const after = h.routers.findById(id)?.passwordEncrypted;
    expect(after).not.toBe(before);
    expect(decryptSecret(after ?? '', ENCRYPTION_KEY)).toBe('otra-contrasena');
  });

  it('rechaza renombrar al nombre de otro router, pero permite el propio', async () => {
    const h = harness();
    await createRouter(h, { name: 'Oficina', host: '10.0.0.1' });
    const second = await createRouter(h, { name: 'Almacen', host: '10.0.0.2' });

    expect(unwrapError(await h.service.update(second, { name: 'Oficina' })).message).toContain('Oficina');
    expect(unwrap(await h.service.update(second, { name: 'Almacen' })).name).toBe('Almacen');
  });

  it('invalida la conexion del pool si cambia un dato de conexion', async () => {
    const h = harness();
    const id = await createRouter(h);
    registerTelemetry(h);

    // Abre una conexion real contra el backend simulado.
    unwrap(await h.service.getSnapshot(id));
    expect(h.pool.size).toBe(1);

    unwrap(await h.service.update(id, { host: '10.0.0.9' }));

    expect(h.pool.size).toBe(0);
  });

  it('no invalida la conexion si solo cambia el nombre', async () => {
    const h = harness();
    const id = await createRouter(h);
    registerTelemetry(h);
    unwrap(await h.service.getSnapshot(id));

    unwrap(await h.service.update(id, { name: 'Mismo equipo' }));

    expect(h.pool.size).toBe(1);
  });

  it('valida el parche y devuelve NOT_FOUND si el router no existe', async () => {
    const h = harness();
    const id = await createRouter(h);

    expect(unwrapError(await h.service.update(id, { port: -1 })).code).toBe('VALIDATION_ERROR');
    expect(
      unwrapError(await h.service.update('00000000-0000-4000-8000-000000000000' as UUID, { name: 'x' }))
        .code,
    ).toBe('NOT_FOUND');
  });

  it('acepta un parche vacio sin efectos colaterales', async () => {
    const h = harness();
    const id = await createRouter(h, { name: 'Oficina' });
    const empty: RouterUpdateInput = {};

    expect(unwrap(await h.service.update(id, empty)).name).toBe('Oficina');
  });
});

describe('createRouterService.remove', () => {
  it('hace borrado logico y cierra la conexion', async () => {
    const h = harness();
    const id = await createRouter(h);
    registerTelemetry(h);
    unwrap(await h.service.getSnapshot(id));

    unwrap(await h.service.remove(id));

    expect(h.routers.findById(id)).toBeNull();
    expect(h.pool.size).toBe(0);
    // La fila sigue en disco (soft delete), pero invisible para el repositorio.
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM routers').get()).toEqual({ n: 1 });
  });
});

describe('createRouterService.testConnection', () => {
  it('mide la latencia y marca el router como online', async () => {
    const h = harness();
    const id = await createRouter(h);
    h.backend.set('/system/identity', [{ name: 'MikroTik-CCR' }]);
    h.backend.onCall = () => {
      h.clock.advance(7);
    };

    const result = unwrap(await h.service.testConnection(id));

    expect(result.latencyMs).toBe(7);
    const stored = h.routers.findById(id);
    expect(stored?.status).toBe('online');
    expect(stored?.lastSeenAt).not.toBeNull();
    expect(stored?.lastError).toBeNull();
  });

  it('persiste unauthorized y propaga el fallo de credenciales', async () => {
    const h = harness();
    const id = await createRouter(h);
    h.backend.fail(
      '/system/identity',
      new MikrotikError({ code: 'AUTH_FAILED', message: 'invalid user name or password' }),
    );

    await expect(h.service.testConnection(id)).rejects.toBeInstanceOf(MikrotikError);

    const stored = h.routers.findById(id);
    expect(stored?.status).toBe('unauthorized');
    expect(stored?.lastError).toContain('password');
    // Un fallo de credenciales NO es "visto": `last_seen_at` no avanza.
    expect(stored?.lastSeenAt).toBeNull();
  });

  it('persiste offline cuando el socket no responde', async () => {
    const h = harness();
    const id = await createRouter(h);
    h.backend.fail(
      '/system/identity',
      new MikrotikError({ code: 'CONNECTION_REFUSED', message: 'ECONNREFUSED' }),
    );

    await expect(h.service.testConnection(id)).rejects.toBeInstanceOf(MikrotikError);

    expect(h.routers.findById(id)?.status).toBe('offline');
  });

  it('NOT_FOUND si el router no existe (no toca la red)', async () => {
    const h = harness();

    expect(
      unwrapError(await h.service.testConnection('00000000-0000-4000-8000-000000000000' as UUID)).code,
    ).toBe('NOT_FOUND');
    expect(h.backend.calls).toHaveLength(0);
  });
});

describe('statusFromFailure', () => {
  const status = (code: MikrotikError['code'], transport: boolean): RouterStatus => {
    const error = new MikrotikError({ code, message: 'x' });

    // `isTransportError` es derivado del codigo: validamos coherencia.
    expect(error.isTransportError).toBe(transport);

    return statusFromFailure(error);
  };

  it('AUTH_FAILED es unauthorized', () => {
    expect(status('AUTH_FAILED', true)).toBe('unauthorized');
  });

  it('los fallos de transporte son offline', () => {
    expect(status('CONNECTION_REFUSED', true)).toBe('offline');
    expect(status('CONNECTION_TIMEOUT', true)).toBe('offline');
    expect(status('TLS_ERROR', true)).toBe('offline');
  });

  it('un trap significa que el equipo respondio: sigue online', () => {
    expect(status('TRAP', false)).toBe('online');
    expect(status('PROTOCOL_ERROR', false)).toBe('online');
  });

  it('un error ajeno a RouterOS deja el estado como unknown', () => {
    expect(statusFromFailure(new Error('otro'))).toBe('unknown');
  });
});

describe('createRouterService.getSnapshot', () => {
  it('ensambla identidad, recursos, interfaces y sesiones activas', async () => {
    const h = harness();
    const id = await createRouter(h);
    registerTelemetry(h, { sessions: 3 });

    const snapshot = unwrap(await h.service.getSnapshot(id));

    expect(snapshot.routerId).toBe(id);
    expect(snapshot.identity.name).toBe('MikroTik-CCR');
    expect(snapshot.resource.version).toBe('7.16.1');
    expect(snapshot.resource.cpuLoad).toBe(5);
    expect(snapshot.interfaces).toHaveLength(1);
    expect(snapshot.interfaces[0]?.name).toBe('ether1');
    expect(snapshot.activeHotspotSessions).toBe(3);
    expect(Date.parse(snapshot.capturedAt)).not.toBeNaN();
  });

  it('health es null si el board no expone sensores (trap normal)', async () => {
    const h = harness();
    const id = await createRouter(h);
    registerTelemetry(h);
    h.backend.fail(
      '/system/health',
      new MikrotikError({ code: 'TRAP', message: 'no such command prefix' }),
    );

    expect(unwrap(await h.service.getSnapshot(id)).health).toBeNull();
  });

  it('health refleja los sensores cuando el board los expone', async () => {
    const h = harness();
    const id = await createRouter(h);
    registerTelemetry(h);
    h.backend.set('/system/health', [{ temperature: '42', voltage: '24.0' }]);

    expect(unwrap(await h.service.getSnapshot(id)).health).toEqual({ temperature: 42, voltage: 24 });
  });

  it('propaga el fallo si el equipo no responde', async () => {
    const h = harness();
    const id = await createRouter(h);
    registerTelemetry(h);
    h.backend.fail(
      '/system/identity',
      new MikrotikError({ code: 'CONNECTION_TIMEOUT', message: 'timeout' }),
    );

    await expect(h.service.getSnapshot(id)).rejects.toBeInstanceOf(MikrotikError);
  });
});

describe('createRouterService.listInterfaces', () => {
  it('calcula la tasa a partir de dos muestras reales', async () => {
    const h = harness();
    const id = await createRouter(h);
    h.backend.setSequence('/interface', [
      [
        { name: 'ether1', 'rx-byte': '1000', 'tx-byte': '2000' },
        { name: 'wlan1', 'rx-byte': '0', 'tx-byte': '0' },
      ],
      [
        { name: 'ether1', 'rx-byte': '126000', 'tx-byte': '202000' },
        { name: 'wlan1', 'rx-byte': '5000', 'tx-byte': '0' },
      ],
    ]);

    const stats = unwrap(await h.service.listInterfaces(id));
    const ether1 = stats.find((stat) => stat.name === 'ether1');
    const wlan1 = stats.find((stat) => stat.name === 'wlan1');

    expect(stats).toHaveLength(2);
    // 125000 bytes en 1 s = 1 Mbps; 200000 bytes = 1.6 Mbps.
    expect(ether1?.rxRateBps).toBe(1_000_000);
    expect(ether1?.txRateBps).toBe(1_600_000);
    expect(wlan1?.rxRateBps).toBe(40_000);
    expect(wlan1?.txRateBps).toBe(0);
    // La tasa se calcula sobre el intervalo REAL (la espera), no sobre el RTT.
    expect(h.backend.calls.filter((command) => command.path === '/interface')).toHaveLength(2);
  });

  it('una interfaz que no aparece en la muestra previa no inventa tasa', async () => {
    const h = harness();
    const id = await createRouter(h);
    h.backend.setSequence('/interface', [
      [{ name: 'ether1', 'rx-byte': '0' }],
      [{ name: 'ether9', 'rx-byte': '9999' }],
    ]);

    const stats = unwrap(await h.service.listInterfaces(id));

    expect(stats[0]?.name).toBe('ether9');
    expect(stats[0]?.rxRateBps).toBe(0);
  });

  it('NOT_FOUND si el router no existe', async () => {
    const h = harness();

    expect(
      unwrapError(await h.service.listInterfaces('00000000-0000-4000-8000-000000000000' as UUID)).code,
    ).toBe('NOT_FOUND');
  });
});
