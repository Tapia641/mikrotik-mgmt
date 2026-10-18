import type {
  MikrotikClient,
  Result,
  RosCommand,
  RosConnectionOptions,
  RosReply,
  Router,
  UUID,
} from '@/types';

import { notFound } from '@/core/errors';
import { getConnectionPool, type ConnectionPool } from '@/core/mikrotik/pool';
import { routerRepository, type RouterRepository } from '@/database/repositories';
import { decryptSecret } from '@/lib/crypto';
import { env } from '@/lib/env';

/**
 * Acceso a un equipo concreto, compartido por todos los servicios que hablan
 * con un router (routers, hotspot, vouchers, informes).
 *
 * Resolver la entidad, descifrar su contrasena y pedir una conexion al pool es
 * exactamente lo mismo en los cuatro; centralizarlo evita que cada servicio
 * reimplemente —y con el tiempo desvie— la politica de conexion.
 *
 * Contrato de errores: la ausencia del router viaja por el canal `Result`
 * (es un desenlace esperado, 404); un fallo de transporte o del equipo se
 * **lanza** como `MikrotikError` y el borde HTTP lo traduce a 502/504.
 */
export interface RosExecutorDeps {
  readonly routers?: RouterRepository;
  readonly pool?: ConnectionPool;
  readonly encryptionKey?: string;
}

export interface RosExecutor {
  /** Router existente o `NOT_FOUND` por el canal `Result`. */
  find(routerId: UUID): Result<Router>;
  /** Opciones de socket del router; descifra la contrasena en el ultimo momento. */
  connectionOptions(router: Router): RosConnectionOptions;
  /** Conexion persistente al equipo, para quien necesita varias lecturas. */
  acquire(router: Router): Promise<MikrotikClient>;
  /** Cierra y descarta la conexion en cache (p. ej. al cambiar host/puerto). */
  evict(routerId: UUID): Promise<void>;
  /** Ejecuta en el equipo indicado. Un fallo de infraestructura se propaga. */
  execOn(router: Router, command: RosCommand): Promise<RosReply>;
  /**
   * Ejecuta un comando **mutante**. Separado a proposito de `execOn`: el
   * cliente rechaza las escrituras por el camino de lectura, de modo que un
   * error de programacion no puede cambiar la configuracion del router.
   */
  executeOn(router: Router, command: RosCommand): Promise<RosReply>;
}

export function createRosExecutor(deps: RosExecutorDeps = {}): RosExecutor {
  const routers = deps.routers ?? routerRepository;
  const pool = deps.pool ?? getConnectionPool();
  const encryptionKey = deps.encryptionKey ?? env.ENCRYPTION_KEY;

  /** Opciones de socket a partir de la entidad. */
  function connectionOptions(router: Router): RosConnectionOptions {
    return {
      host: router.host,
      port: router.port,
      username: router.username,
      password: decryptSecret(router.passwordEncrypted, encryptionKey),
      timeoutMs: router.timeoutMs,
      tls: {
        enabled: router.protocol === 'api-ssl',
        rejectUnauthorized: !router.tlsInsecure,
      },
    };
  }

  return {
    find(routerId) {
      const router = routers.findById(routerId);

      return router === null
        ? { ok: false, error: notFound('Router', routerId) }
        : { ok: true, value: router };
    },

    connectionOptions,

    acquire(router) {
      return pool.acquire(router.id, connectionOptions(router));
    },

    evict(routerId) {
      return pool.evict(routerId);
    },

    async execOn(router, command) {
      const client = await pool.acquire(router.id, connectionOptions(router));

      return client.exec(command);
    },

    async executeOn(router, command) {
      const client = await pool.acquire(router.id, connectionOptions(router));

      return client.execute(command);
    },
  };
}
