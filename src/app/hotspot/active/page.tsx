import type { PublicRouter } from '@/types';

import { routerService } from '@/core/services';

import { HotspotActiveClient } from './active-client';

export const metadata = { title: 'Sesiones Hotspot' };

export default async function HotspotActivePage() {
  const result = await routerService.list({ pageSize: 200 });
  const routers: readonly PublicRouter[] = result.ok ? result.value.items : [];

  return <HotspotActiveClient initialRouterId={routers[0]?.id ?? ''} routers={routers} />;
}