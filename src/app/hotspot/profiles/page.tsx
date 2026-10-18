import type { PublicRouter } from '@/types';

import { routerService } from '@/core/services';

import { HotspotProfilesClient } from './profiles-client';

export const metadata = { title: 'Perfiles Hotspot' };

export default async function HotspotProfilesPage() {
  const result = await routerService.list({ pageSize: 200 });
  const routers: readonly PublicRouter[] = result.ok ? result.value.items : [];

  return <HotspotProfilesClient initialRouterId={routers[0]?.id ?? ''} routers={routers} />;
}