import type { PublicRouter } from '@/types';

import { routerService } from '@/core/services';

import { HotspotUsersClient } from './users-client';

export const metadata = { title: 'Usuarios Hotspot' };

export default async function HotspotUsersPage() {
  const result = await routerService.list({ pageSize: 200 });
  const routers: readonly PublicRouter[] = result.ok ? result.value.items : [];

  return <HotspotUsersClient initialRouterId={routers[0]?.id ?? ''} routers={routers} />;
}