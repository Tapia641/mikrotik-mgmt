import type { RosCommand } from '@/types';

import { ROS_PATHS } from '@/core/constants';

/** Builders de comandos de sistema y red (`/system`, `/interface`, `/ip`). */
export const systemCommands = {
  getIdentity: (): RosCommand => ({
    path: ROS_PATHS.identity,
    action: 'print',
    readOnly: true,
  }),

  getResource: (): RosCommand => ({
    path: ROS_PATHS.resource,
    action: 'print',
    readOnly: true,
  }),

  getHealth: (): RosCommand => ({
    path: ROS_PATHS.health,
    action: 'print',
    readOnly: true,
  }),

  listInterfaces: (): RosCommand => ({
    path: ROS_PATHS.interfaces,
    action: 'print',
    params: { '.proplist': 'name,type,mtu,running,disabled,mac-address,comment' },
    readOnly: true,
  }),

  /**
   * Monitor de trafico continuo por interfaz. Es la base del monitoreo en vivo:
   * NO lleva `action` ni `once`, porque RouterOS emite un `!re` por intervalo
   * hasta que el stream se cierra (ver `MikrotikClient.stream`).
   */
  monitorTraffic: (interfaceName = 'all'): RosCommand => ({
    path: ROS_PATHS.monitorTraffic,
    params: { interface: interfaceName },
    readOnly: true,
  }),

  listAddresses: (): RosCommand => ({
    path: ROS_PATHS.addresses,
    action: 'print',
    readOnly: true,
  }),

  listPools: (): RosCommand => ({
    path: ROS_PATHS.pools,
    action: 'print',
    readOnly: true,
  }),

  listLogs: (): RosCommand => ({
    path: ROS_PATHS.log,
    action: 'print',
    readOnly: true,
  }),
} as const;
