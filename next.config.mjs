/**
 * MikroTik Web Manager - configuracion de Next.js
 *
 * `serverExternalPackages` mantiene los modulos nativos (better-sqlite3) y los
 * clientes de sockets (@fibercom/routeros-api) fuera del bundle de servidor,
 * para que se resuelvan desde node_modules en tiempo de ejecucion.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3', '@fibercom/routeros-api'],
  typedRoutes: false,
  logging: {
    fetches: { fullUrl: true },
  },
};

export default nextConfig;
