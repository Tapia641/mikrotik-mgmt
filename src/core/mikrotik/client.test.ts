import { describe, expect, it } from 'vitest';

import type { MikrotikFailure, RosCommand, RosConnectionOptions, RosItem, RosTrap } from '@/types';

import { RouterOsClient, buildWords } from './client';
import { MikrotikError } from './errors';
import type { RosStreamHandle, RosTransport, RosTransportFactory } from './transport';

/* ── Dobles ──────────────────────────────────────────────────────────────── */

class FakeStream implements RosStreamHandle {
  public closed = 0;
  private dataHandler: ((item: RosItem) => void) | null = null;
  private trapHandler: ((trap: RosTrap) => void) | null = null;
  private errorHandler: ((error: unknown) => void) | null = null;

  public onData(handler: (item: RosItem) => void): void {
    this.dataHandler = handler;
  }

  public onTrap(handler: (trap: RosTrap) => void): void {
    this.trapHandler = handler;
  }

  public onError(handler: (error: unknown) => void): void {
    this.errorHandler = handler;
  }

  public async close(): Promise<void> {
    this.closed += 1;
  }

  public emitData(item: RosItem): void {
    this.dataHandler?.(item);
  }

  public emitTrap(trap: RosTrap): void {
    this.trapHandler?.(trap);
  }

  public emitError(error: unknown): void {
    this.errorHandler?.(error);
  }
}

class FakeTransport implements RosTransport {
  public readonly sent: string[][] = [];
  public readonly streams: FakeStream[] = [];
  public connected = false;
  public connectCalls = 0;
  public closeCalls = 0;
  public reply: readonly RosItem[] = [];
  public connectError: unknown = null;
  public closeError: unknown = null;
  public sendError: unknown = null;

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.connectError !== null) throw this.connectError;
    this.connected = true;
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeError !== null) throw this.closeError;
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async send(words: readonly string[]): Promise<readonly RosItem[]> {
    this.sent.push([...words]);
    if (this.sendError !== null) throw this.sendError;
    return this.reply;
  }

  public listen(words: readonly string[]): RosStreamHandle {
    this.sent.push([...words]);
    const stream = new FakeStream();
    this.streams.push(stream);
    return stream;
  }
}

const OPTIONS: RosConnectionOptions = {
  host: '192.168.88.1',
  port: 8728,
  username: 'admin',
  password: 's3cret',
  timeoutMs: 5_000,
};

function setup(): {
  readonly client: RouterOsClient;
  readonly transport: FakeTransport;
  readonly factoryCalls: RosConnectionOptions[];
} {
  const transport = new FakeTransport();
  const factoryCalls: RosConnectionOptions[] = [];
  const factory: RosTransportFactory = (options) => {
    factoryCalls.push(options);
    return transport;
  };

  return { client: new RouterOsClient(OPTIONS, factory), transport, factoryCalls };
}

/** Simula un `RosException` de la libreria. */
function rosException(errno: string, message = errno): Error {
  return Object.assign(new Error(message), { errno });
}

const PRINT_USERS: RosCommand = {
  path: '/ip/hotspot/user',
  action: 'print',
  readOnly: true,
};

/* ── Pruebas ─────────────────────────────────────────────────────────────── */

describe('buildWords', () => {
  it('une path y action', () => {
    expect(buildWords(PRINT_USERS)).toEqual(['/ip/hotspot/user/print']);
  });

  it('omite la action cuando no hay', () => {
    expect(buildWords({ path: '/system/identity' })).toEqual(['/system/identity']);
  });

  it('usa filtro de consulta (?k=v) en comandos de lectura', () => {
    const words = buildWords({
      path: '/interface',
      action: 'print',
      params: { running: true, interface: 'all' },
      readOnly: true,
    });

    expect(words).toEqual(['/interface/print', '?running=yes', '?interface=all']);
  });

  it('usa asignacion en un comando sin action (streams)', () => {
    const words = buildWords({
      path: '/interface/monitor-traffic',
      params: { interface: 'ether1' },
      readOnly: true,
    });

    expect(words).toEqual(['/interface/monitor-traffic', '=interface=ether1']);
  });

  it('trata las referencias de campo (.id, .proplist) como asignacion', () => {
    const remove = buildWords({
      path: '/ip/hotspot/user',
      action: 'remove',
      params: { '.id': '*1A' },
      readOnly: false,
    });
    const print = buildWords({
      path: '/interface',
      action: 'print',
      params: { '.proplist': 'name,type' },
      readOnly: true,
    });

    expect(remove).toEqual(['/ip/hotspot/user/remove', '=.id=*1A']);
    expect(print).toEqual(['/interface/print', '=.proplist=name,type']);
  });

  it('usa asignacion (=k=v) en comandos mutantes', () => {
    const words = buildWords({
      path: '/ip/hotspot/user',
      action: 'add',
      params: { name: 'v-001', password: '1234', profile: '1h', limitUptime: 3600 },
      readOnly: false,
    });

    expect(words).toEqual([
      '/ip/hotspot/user/add',
      '=name=v-001',
      '=password=1234',
      '=profile=1h',
      '=limitUptime=3600',
    ]);
  });

  it('no confunde los parametros con los booleanos de RouterOS', () => {
    const words = buildWords({
      path: '/ip/hotspot/user',
      action: 'add',
      params: { disabled: false, 'limit-bytes-in': 0 },
      readOnly: false,
    });

    expect(words).toEqual(['/ip/hotspot/user/add', '=disabled=no', '=limit-bytes-in=0']);
  });
});

describe('RouterOsClient — ciclo de conexion', () => {
  it('conecta una sola vez aunque se llame dos veces', async () => {
    const { client, transport, factoryCalls } = setup();

    await client.connect();
    await client.connect();

    expect(transport.connectCalls).toBe(1);
    expect(factoryCalls).toHaveLength(1);
    expect(client.isConnected()).toBe(true);
  });

  it('expone las opciones recibidas', () => {
    const { client } = setup();

    expect(client.getOptions()).toEqual(OPTIONS);
  });

  it('disconnect es idempotente', async () => {
    const { client, transport } = setup();

    await client.connect();
    await client.disconnect();
    await client.disconnect();

    expect(transport.closeCalls).toBe(1);
    expect(client.isConnected()).toBe(false);
  });

  it('traduce el fallo de conexion a MikrotikError', async () => {
    const { client, transport } = setup();
    transport.connectError = rosException('SOCKTMOUT');

    await expect(client.connect()).rejects.toThrow(MikrotikError);
    await expect(client.connect()).rejects.toMatchObject({
      code: 'CONNECTION_TIMEOUT',
      command: 'connect',
    });
  });
});

describe('RouterOsClient — exec / execute', () => {
  it('conecta de forma perezosa al ejecutar', async () => {
    const { client, transport } = setup();
    transport.reply = [{ name: 'v-001' }];

    const reply = await client.exec(PRINT_USERS);

    expect(transport.connectCalls).toBe(1);
    expect(reply.done).toBe(true);
    expect(reply.items).toEqual([{ name: 'v-001' }]);
    expect(transport.sent).toEqual([['/ip/hotspot/user/print']]);
  });

  it('exec rechaza comandos mutantes sin tocar el router', async () => {
    const { client, transport } = setup();

    await expect(
      client.exec({ path: '/ip/hotspot/user', action: 'add', readOnly: false }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });

    expect(transport.sent).toHaveLength(0);
    expect(transport.connectCalls).toBe(0);
  });

  it('execute acepta comandos mutantes', async () => {
    const { client, transport } = setup();

    await client.execute({
      path: '/ip/hotspot/user',
      action: 'add',
      params: { name: 'v-001' },
      readOnly: false,
    });

    expect(transport.sent).toEqual([['/ip/hotspot/user/add', '=name=v-001']]);
  });

  it('traduce el trap del router conservando el command', async () => {
    const { client, transport } = setup();
    transport.sendError = rosException('TRAP', 'no such item (4)');

    await expect(client.exec(PRINT_USERS)).rejects.toMatchObject({
      code: 'TRAP',
      message: 'no such item (4)',
      command: '/ip/hotspot/user/print',
    });
  });

  it('reconecta cuando el socket se cayo', async () => {
    const { client, transport } = setup();

    await client.exec(PRINT_USERS);
    transport.connected = false;

    await client.exec(PRINT_USERS);

    expect(transport.connectCalls).toBe(2);
    expect(transport.closeCalls).toBe(1);
  });

  it('falla con CONNECTION_REFUSED si tras conectar el transporte no esta vivo', async () => {
    const transport = new FakeTransport();
    transport.connect = async (): Promise<void> => {
      transport.connectCalls += 1;
    };
    const client = new RouterOsClient(OPTIONS, () => transport);

    await expect(client.exec(PRINT_USERS)).rejects.toMatchObject({
      code: 'CONNECTION_REFUSED',
      command: '/ip/hotspot/user/print',
    });
  });

  it('propaga el fallo de disconnect', async () => {
    const { client, transport } = setup();
    await client.connect();
    transport.closeError = rosException('ECONNRESET');

    await expect(client.disconnect()).rejects.toMatchObject({ code: 'CONNECTION_REFUSED' });
  });
});

describe('RouterOsClient — stream', () => {
  it('entrega los items y permite cerrar el stream', async () => {
    const { client, transport } = setup();
    const received: RosItem[] = [];

    const stop = await client.stream(
      { path: '/ip/hotspot/active', action: 'print', readOnly: true },
      (item) => received.push(item),
    );

    const stream = transport.streams[0];
    expect(stream).toBeDefined();
    stream?.emitData({ name: 'ether1', 'rx-bits-per-second': '1000' });

    expect(received).toEqual([{ name: 'ether1', 'rx-bits-per-second': '1000' }]);
    expect(transport.sent).toEqual([['/ip/hotspot/active/print']]);

    await stop();
    expect(stream?.closed).toBe(1);
  });

  it('reporta los traps del stream como MikrotikError TRAP', async () => {
    const { client, transport } = setup();
    const errors: MikrotikFailure[] = [];

    await client.stream(PRINT_USERS, () => undefined, (error) => errors.push(error));

    transport.streams[0]?.emitTrap({ message: 'interrupted' });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('TRAP');
    expect(errors[0]?.command).toBe('/ip/hotspot/user/print');
  });

  it('reporta los fallos de transporte del stream', async () => {
    const { client, transport } = setup();
    const errors: MikrotikFailure[] = [];

    await client.stream(PRINT_USERS, () => undefined, (error) => errors.push(error));

    transport.streams[0]?.emitError(rosException('ECONNRESET'));

    expect(errors[0]?.code).toBe('CONNECTION_REFUSED');
  });

  it('tolera no recibir manejador de error (un stream no debe tumbar la app)', async () => {
    const { client, transport } = setup();

    await expect(client.stream(PRINT_USERS, () => undefined)).resolves.toBeTypeOf('function');

    expect(() => transport.streams[0]?.emitError(rosException('TRAP'))).not.toThrow();
  });
});
