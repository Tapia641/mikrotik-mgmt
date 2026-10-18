import { describe, expect, it } from 'vitest';

import { ROS_PATHS } from '@/core/constants';

import { hotspotCommands } from './hotspot';
import { systemCommands } from './system';
import { buildWords } from '../client';

describe('hotspotCommands', () => {
  it('marca las lecturas como solo-lectura', () => {
    const reads = [
      hotspotCommands.listServers(),
      hotspotCommands.listProfiles(),
      hotspotCommands.listUsers(),
      hotspotCommands.listActive(),
      hotspotCommands.listHosts(),
    ];

    for (const command of reads) {
      expect(command.readOnly).toBe(true);
      expect(command.action).toBe('print');
    }

    expect(hotspotCommands.listActive().path).toBe(ROS_PATHS.hotspotActive);
    expect(hotspotCommands.listHosts().path).toBe(ROS_PATHS.hotspotHost);
    expect(hotspotCommands.listServers().path).toBe(ROS_PATHS.hotspotServer);
  });

  it('marca las escrituras como mutantes', () => {
    expect(hotspotCommands.addProfile('1h').readOnly).toBe(false);
    expect(hotspotCommands.removeProfile('*1').readOnly).toBe(false);
    expect(hotspotCommands.addUser('v-1', 'p', '1h').readOnly).toBe(false);
    expect(hotspotCommands.removeUser('*2').readOnly).toBe(false);
    expect(hotspotCommands.disconnectSession('*3').readOnly).toBe(false);
  });

  it('construye el alta de usuario con perfil y parametros extra', () => {
    const command = hotspotCommands.addUser('v-001', '4821', '1h-1d', {
      'limit-uptime': '1h',
      'limit-bytes-out': 104857600,
    });

    expect(buildWords(command)).toEqual([
      '/ip/hotspot/user/add',
      '=name=v-001',
      '=password=4821',
      '=profile=1h-1d',
      '=limit-uptime=1h',
      '=limit-bytes-out=104857600',
    ]);
  });

  it('no deja que los parametros extra sobrescriban lo obligatorio', () => {
    const command = hotspotCommands.addUser('v-001', '4821', '1h', { name: 'otro' });

    expect(command.params?.name).toBe('v-001');
    expect(command.params?.profile).toBe('1h');
  });

  it('referencia items por `.id` al borrar', () => {
    expect(buildWords(hotspotCommands.removeUser('*1A'))).toEqual([
      '/ip/hotspot/user/remove',
      '=.id=*1A',
    ]);
  });

  it('desconecta una sesion activa con remove sobre `/ip/hotspot/active`', () => {
    const command = hotspotCommands.disconnectSession('*5');

    expect(command.path).toBe(ROS_PATHS.hotspotActive);
    expect(command.action).toBe('remove');
    expect(buildWords(command)).toEqual(['/ip/hotspot/active/remove', '=.id=*5']);
  });

  it('alta un perfil con nombre y parametros de limite', () => {
    const command = hotspotCommands.addProfile('30d', { 'rate-limit': '2M/2M' });

    expect(buildWords(command)).toEqual([
      '/ip/hotspot/user/profile/add',
      '=name=30d',
      '=rate-limit=2M/2M',
    ]);
  });
});

describe('systemCommands', () => {
  it('todas son lecturas', () => {
    const commands = [
      systemCommands.getIdentity(),
      systemCommands.getResource(),
      systemCommands.getHealth(),
      systemCommands.listInterfaces(),
      systemCommands.monitorTraffic(),
      systemCommands.listAddresses(),
      systemCommands.listPools(),
      systemCommands.listLogs(),
    ];

    for (const command of commands) {
      expect(command.readOnly).toBe(true);
    }
  });

  it('apunta a los paths esperados', () => {
    expect(systemCommands.getIdentity().path).toBe(ROS_PATHS.identity);
    expect(systemCommands.getResource().path).toBe(ROS_PATHS.resource);
    expect(systemCommands.getHealth().path).toBe(ROS_PATHS.health);
    expect(systemCommands.listInterfaces().path).toBe(ROS_PATHS.interfaces);
    expect(systemCommands.listAddresses().path).toBe(ROS_PATHS.addresses);
    expect(systemCommands.listPools().path).toBe(ROS_PATHS.pools);
    expect(systemCommands.listLogs().path).toBe(ROS_PATHS.log);
  });

  it('pide un proplist de interfaces como asignacion, no como filtro', () => {
    const words = buildWords(systemCommands.listInterfaces());

    expect(words[0]).toBe('/interface/print');
    expect(words[1]).toBe('=.proplist=name,type,mtu,running,disabled,mac-address,comment');
  });

  it('monitorea trafico con asignacion de interfaz', () => {
    expect(buildWords(systemCommands.monitorTraffic())).toEqual([
      '/interface/monitor-traffic',
      '=interface=all',
    ]);
    expect(buildWords(systemCommands.monitorTraffic('ether1'))).toEqual([
      '/interface/monitor-traffic',
      '=interface=ether1',
    ]);
  });
});
