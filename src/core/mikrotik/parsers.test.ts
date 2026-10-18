import { describe, expect, it } from 'vitest';

import type { RosItem } from '@/types';

import {
  computeRateBps,
  deriveUserStatus,
  parseRosDuration,
  readRosBoolean,
  readRosDurationSeconds,
  readRosNumber,
  readRosString,
  toHotspotActiveSession,
  toHotspotHost,
  toHotspotProfile,
  toHotspotServer,
  toHotspotUser,
  toInterfaceConfig,
  toInterfaceCounters,
  toInterfaceStat,
  toRouterHealth,
  toRouterIdentity,
  toRouterResource,
} from './parsers';

describe('parsers: lectura tolerante del wire format de RouterOS', () => {
  it('readRosString distingue ausente de vacio', () => {
    const item: RosItem = { name: 'ether1', comment: '' };

    expect(readRosString(item, 'name')).toBe('ether1');
    expect(readRosString(item, 'comment')).toBeUndefined();
    expect(readRosString(item, 'no-existe')).toBeUndefined();
  });

  it('readRosNumber degrada basura a 0, no a NaN', () => {
    const item: RosItem = { good: '1024', bad: 'n/a', empty: '', zero: '0' };

    expect(readRosNumber(item, 'good')).toBe(1024);
    expect(readRosNumber(item, 'bad')).toBe(0);
    expect(readRosNumber(item, 'empty')).toBe(0);
    expect(readRosNumber(item, 'zero')).toBe(0);
    expect(readRosNumber(item, 'missing')).toBe(0);
    expect(Number.isNaN(readRosNumber(item, 'bad'))).toBe(false);
  });

  it('readRosBoolean solo acepta el literal "true"', () => {
    const item: RosItem = { a: 'true', b: 'false', c: 'yes', d: '1' };

    expect(readRosBoolean(item, 'a')).toBe(true);
    expect(readRosBoolean(item, 'b')).toBe(false);
    expect(readRosBoolean(item, 'c')).toBe(false);
    expect(readRosBoolean(item, 'd')).toBe(false);
    expect(readRosBoolean(item, 'missing')).toBe(false);
  });
});

describe('parsers: /system/identity', () => {
  it('conserva los campos presentes y omite los ausentes', () => {
    const identity = toRouterIdentity({
      name: 'MikroTik-CCR',
      'board-name': 'CCR2004-1G-12S+2XS',
      version: '7.16.1',
      uptime: '3w1d',
    });

    expect(identity.name).toBe('MikroTik-CCR');
    expect(identity.boardName).toBe('CCR2004-1G-12S+2XS');
    expect(identity.version).toBe('7.16.1');
    expect(identity.uptime).toBe('3w1d');
    expect(identity).not.toHaveProperty('platform');
    expect(identity).not.toHaveProperty('architectureName');
  });

  it('usa un nombre de reserva si el equipo no lo reporta', () => {
    expect(toRouterIdentity({}).name).toBe('sin-nombre');
  });
});

describe('parsers: /system/resource', () => {
  it('mapea memoria, CPU y disco con reservas para los obligatorios', () => {
    const resource = toRouterResource({
      uptime: '1d2h',
      version: '7.16.1',
      'board-name': 'hEX',
      cpu: 'MT7621A',
      'cpu-count': '4',
      'cpu-frequency': '880',
      'cpu-load': '7',
      'free-memory': '134217728',
      'total-memory': '268435456',
      'free-hdd-space': '10485760',
      'total-hdd-space': '16777216',
    });

    expect(resource.uptime).toBe('1d2h');
    expect(resource.cpu).toBe('MT7621A');
    expect(resource.cpuCount).toBe('4');
    expect(resource.cpuLoad).toBe(7);
    expect(resource.freeMemory).toBe(134_217_728);
    expect(resource.totalMemory).toBe(268_435_456);
    expect(resource.totalHddSpace).toBe(16_777_216);
  });

  it('rellena los campos obligatorios cuando el equipo responde parcial', () => {
    const resource = toRouterResource({ 'cpu-load': '3' });

    expect(resource.uptime).toBe('0s');
    expect(resource.version).toBe('desconocida');
    expect(resource.cpu).toBe('desconocida');
    expect(resource.cpuCount).toBe('0');
    expect(resource.cpuLoad).toBe(3);
    expect(resource.freeMemory).toBe(0);
  });
});

describe('parsers: /system/health', () => {
  it('expone solo los sensores presentes', () => {
    const health = toRouterHealth({ temperature: '41', voltage: '24.1' });

    expect(health.temperature).toBe(41);
    expect(health.voltage).toBe(24.1);
    expect(health).not.toHaveProperty('fanSpeed');
    expect(health).not.toHaveProperty('powerConsumption');
  });

  it('acepta fan1-speed (v7) y fan-speed (v6) como el mismo dato', () => {
    expect(toRouterHealth({ 'fan1-speed': '4200' }).fanSpeed).toBe(4200);
    expect(toRouterHealth({ 'fan-speed': '4100' }).fanSpeed).toBe(4100);
  });

  it('devuelve un objeto vacio si el board no tiene sensores', () => {
    expect(Object.keys(toRouterHealth({}))).toHaveLength(0);
  });
});

describe('parsers: tasas de trafico', () => {
  it('convierte el delta de bytes en bits por segundo', () => {
    // 125000 bytes en 1 s = 1 Mbps.
    expect(computeRateBps(0, 125_000, 1_000)).toBe(1_000_000);
    // 1000 bytes en 0.5 s = 16 kbps.
    expect(computeRateBps(0, 1_000, 500)).toBe(16_000);
  });

  it('devuelve 0 en lugar de valores absurdos', () => {
    expect(computeRateBps(100, 100, 1_000)).toBe(0);
    // Contador reiniciado (reboot): el delta es negativo.
    expect(computeRateBps(5_000, 10, 1_000)).toBe(0);
    expect(computeRateBps(0, 1_000, 0)).toBe(0);
    expect(computeRateBps(0, 1_000, -5)).toBe(0);
  });

  it('redondea a bits enteros', () => {
    // 1 byte en 3 s = 2.666 bps → 3.
    expect(computeRateBps(0, 1, 3_000)).toBe(3);
  });

  it('toInterfaceCounters extrae rx-byte/tx-byte', () => {
    expect(toInterfaceCounters({ 'rx-byte': '2048', 'tx-byte': '512' })).toEqual({
      rxByte: 2048,
      txByte: 512,
    });
  });

  it('la primera muestra no tiene tasa (no hay intervalo previo)', () => {
    const stat = toInterfaceStat({ name: 'ether1', 'rx-byte': '999999' }, null, 1_000);

    expect(stat.rxByte).toBe(999_999);
    expect(stat.rxRateBps).toBe(0);
    expect(stat.txRateBps).toBe(0);
  });

  it('la segunda muestra calcula la tasa contra la anterior', () => {
    const previous = { rxByte: 1_000, txByte: 2_000 };
    const stat = toInterfaceStat(
      { name: 'ether1', 'rx-byte': '126000', 'tx-byte': '202000' },
      previous,
      1_000,
    );

    expect(stat.rxByte).toBe(126_000);
    expect(stat.rxRateBps).toBe(1_000_000);
    expect(stat.txRateBps).toBe(1_600_000);
  });

  it('no cruza contadores entre interfaces distintas', () => {
    const item: RosItem = { name: 'ether2', 'rx-byte': '10' };

    // `ether2` no aparece en la muestra anterior: se trata como primera lectura.
    expect(toInterfaceStat(item, null, 1_000).rxRateBps).toBe(0);
  });

  it('toInterfaceStat refleja el estado de la interfaz y omite opcionales', () => {
    const stat = toInterfaceStat({ name: 'wlan1', type: 'wlan', running: 'true' }, null, 0);

    expect(stat.name).toBe('wlan1');
    expect(stat.type).toBe('wlan');
    expect(stat.running).toBe(true);
    expect(stat.disabled).toBe(false);
    expect(stat).not.toHaveProperty('mtu');
    expect(stat).not.toHaveProperty('macAddress');
  });
});

describe('parsers: configuracion de interfaces', () => {
  it('toInterfaceConfig mapea id, mac y comentario', () => {
    const config = toInterfaceConfig({
      '.id': '*1',
      name: 'ether1',
      type: 'ether',
      mtu: '1500',
      running: 'true',
      'mac-address': 'AA:BB:CC:DD:EE:FF',
      comment: 'uplink',
    });

    expect(config).toEqual({
      id: '*1',
      name: 'ether1',
      type: 'ether',
      mtu: 1500,
      macAddress: 'AA:BB:CC:DD:EE:FF',
      disabled: false,
      running: true,
      comment: 'uplink',
    });
  });

  it('toInterfaceConfig tolera un item casi vacio', () => {
    const config = toInterfaceConfig({});

    expect(config.name).toBe('');
    expect(config.type).toBe('unknown');
    expect(config.macAddress).toBeNull();
    expect(config.comment).toBeNull();
    expect(config.mtu).toBe(0);
  });
});

describe('parsers: duraciones de RouterOS', () => {
  it.each([
    ['1w2d3h4m5s', 604800 + 172800 + 10800 + 240 + 5],
    ['1d2h3m4s', 86400 + 7200 + 180 + 4],
    ['3h20m', 12000],
    ['45s', 45],
    ['1d02:03:04', 86400 + 7200 + 180 + 4],
    ['02:03:04', 7384],
    ['3600', 3600],
    ['', 0],
    [undefined, 0],
    ['basura', 0],
  ])('parseRosDuration(%s) → %i', (text, expected) => {
    expect(parseRosDuration(text as string | undefined)).toBe(expected);
  });

  it('readRosDurationSeconds lee la clave o devuelve 0', () => {
    expect(readRosDurationSeconds({ uptime: '1h' }, 'uptime')).toBe(3600);
    expect(readRosDurationSeconds({}, 'uptime')).toBe(0);
  });
});

describe('parsers: hotspot', () => {
  it('toHotspotProfile aplica defaults para ausentes', () => {
    const profile = toHotspotProfile({ '.id': '*1', name: '1h' });

    expect(profile).toMatchObject({
      id: '*1',
      name: '1h',
      rateLimit: null,
      sharedUsers: 0,
      sessionTimeout: null,
      addMacCookie: false,
      transparentProxy: false,
      disabled: false,
      comment: null,
    });
  });

  it('toHotspotProfile lee rate-limit y booleans', () => {
    const profile = toHotspotProfile({
      '.id': '*2',
      name: '30d',
      'rate-limit': '2M/2M',
      'shared-users': '3',
      'add-mac-cookie': 'true',
      disabled: 'true',
    });

    expect(profile.rateLimit).toBe('2M/2M');
    expect(profile.sharedUsers).toBe(3);
    expect(profile.addMacCookie).toBe(true);
    expect(profile.disabled).toBe(true);
  });

  it('toHotspotUser deriva status (unused / used / disabled) y bytes numericos', () => {
    const unused = toHotspotUser({ '.id': '*1', name: 'u1', profile: '1h' }, false);
    expect(unused.status).toBe('unused');
    expect(unused.bytesIn).toBe(0);

    const used = toHotspotUser(
      { '.id': '*2', name: 'u2', profile: '1h', uptime: '1h', 'bytes-in': '1024' },
      false,
    );
    expect(used.status).toBe('used');
    expect(used.bytesIn).toBe(1024);

    const disabled = toHotspotUser({ '.id': '*3', name: 'u3', profile: '1h', disabled: 'true' }, false);
    expect(disabled.status).toBe('disabled');
  });

  it('toHotspotUser marca active si isOnline', () => {
    const online = toHotspotUser({ '.id': '*1', name: 'u1', profile: '1h' }, true);
    expect(online.status).toBe('active');
  });

  it('toHotspotUser detecta expirado por limit-uptime', () => {
    const expired = toHotspotUser(
      { '.id': '*1', name: 'u1', profile: '1h', uptime: '2h', 'limit-uptime': '1h' },
      false,
    );
    expect(expired.status).toBe('expired');
  });

  it('deriveUserStatus es coherente con toHotspotUser', () => {
    expect(deriveUserStatus({ disabled: 'true' }, false)).toBe('disabled');
    expect(deriveUserStatus({}, false)).toBe('unused');
    expect(deriveUserStatus({ uptime: '1h' }, false)).toBe('used');
    expect(deriveUserStatus({}, true)).toBe('active');
  });

  it('toHotspotActiveSession normaliza bytes y login-by', () => {
    const session = toHotspotActiveSession({
      '.id': '*1',
      user: 'u1',
      address: '10.0.0.2',
      'mac-address': 'AA:BB',
      uptime: '5m',
      'idle-time': '30s',
      'bytes-in': '2048',
      'bytes-out': '4096',
      'login-by': 'http-chap',
      radius: 'true',
    });

    expect(session.bytesIn).toBe(2048);
    expect(session.bytesOut).toBe(4096);
    expect(session.loginBy).toBe('http-chap');
    expect(session.radius).toBe(true);
  });

  it('toHotspotActiveSession mapea login-by desconocido a unknown', () => {
    const session = toHotspotActiveSession({ user: 'u1', 'login-by': 'telepatia' });
    expect(session.loginBy).toBe('unknown');
  });

  it('toHotspotHost y toHotspotServer', () => {
    const host = toHotspotHost({
      '.id': '*h1',
      'mac-address': 'AA:BB',
      address: '10.0.0.3',
      'to-address': '10.0.0.4',
      uptime: '1h',
      'idle-time': '5m',
      'bytes-in': '10',
      'bytes-out': '20',
      authorized: 'true',
      comment: 'cel',
    });
    expect(host.bytesIn).toBe(10);
    expect(host.bytesOut).toBe(20);
    expect(host.authorized).toBe(true);
    expect(host.toAddress).toBe('10.0.0.4');

    const server = toHotspotServer({
      '.id': '*s1',
      name: 'hotspot1',
      interface: 'bridge-lan',
      profile: 'default',
      'address-pool': 'pool1',
    });
    expect(server).toMatchObject({ name: 'hotspot1', interface: 'bridge-lan', profile: 'default', addressPool: 'pool1' });
  });
});
