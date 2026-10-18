import { routerService } from '@/core/services';

import { RoutersClient } from './routers-client';

export const metadata = { title: 'Routers' };

/**
 * CRUD de routers + prueba de conexion.
 *
 * La primera pintura la resuelve el servidor llamando al servicio (mismo
 * contrato que la API): el panel aparece con datos y sin parpadeo de "cargando".
 * Las mutaciones posteriores si pasan por `/api/routers` desde el cliente.
 */
export default async function RoutersPage() {
  const result = await routerService.list({ pageSize: 200 });

  return (
    <section className="p-6">
      <RoutersClient
        initialError={result.ok ? null : result.error.message}
        initialRouters={result.ok ? result.value.items : []}
      />
    </section>
  );
}
