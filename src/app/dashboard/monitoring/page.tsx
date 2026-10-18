import { routerService } from '@/core/services';

import { MonitoringClient } from './monitoring-client';

export const metadata = { title: 'Monitoreo' };

interface MonitoringPageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/**
 * Recursos, interfaces y salud en vivo del router seleccionado.
 *
 * La lista de routers se resuelve en el servidor; el router inicial puede venir
 * de `?router=<id>` (asi el enlace "Monitorear" del listado aterriza en el
 * equipo correcto).
 */
export default async function MonitoringPage({ searchParams }: MonitoringPageProps) {
  const [result, params] = await Promise.all([routerService.list({ pageSize: 200 }), searchParams]);
  const routers = result.ok ? result.value.items : [];

  const requested = params.router;
  const wanted = typeof requested === 'string' ? requested : undefined;
  const initialRouterId = routers.find((router) => router.id === wanted)?.id ?? routers[0]?.id ?? '';

  return (
    <section className="p-6">
      <MonitoringClient
        initialError={result.ok ? null : result.error.message}
        initialRouterId={initialRouterId}
        routers={routers}
      />
    </section>
  );
}
