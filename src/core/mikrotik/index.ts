/**
 * Capa RouterOS (Ports & Adapters).
 *
 *   types (puerto `MikrotikClient`)
 *        └── client.ts        adaptador `@fibercom/routeros-api`
 *        └── transport.ts     frontera con el socket (inyectable)
 *        └── pool.ts          una conexion viva por router
 *        └── commands/        builders puros de comandos por menu
 *        └── errors.ts        MikrotikError + traduccion
 *
 * Regla: ninguna otra capa importa `@fibercom/routeros-api` directamente.
 */
export { RouterOsClient, buildWords } from './client';
export {
  MikrotikError,
  classifyMikrotikFailure,
  isMikrotikError,
  toApiErrorCode,
  toMikrotikError,
  trapToMikrotikError,
} from './errors';
export {
  ConnectionPool,
  closeConnectionPool,
  getConnectionPool,
} from './pool';
export type { ConnectionPoolOptions } from './pool';
export {
  computeRateBps,
  readRosBoolean,
  readRosNumber,
  readRosString,
  toInterfaceConfig,
  toInterfaceCounters,
  toInterfaceStat,
  toRouterHealth,
  toRouterIdentity,
  toRouterResource,
} from './parsers';
export type { InterfaceCounters } from './parsers';
export {
  createRouterOsTransport,
  toRosItem,
  toRosTrap,
} from './transport';
export type { RosStreamHandle, RosTransport, RosTransportFactory } from './transport';
export { hotspotCommands } from './commands/hotspot';
export { systemCommands } from './commands/system';
