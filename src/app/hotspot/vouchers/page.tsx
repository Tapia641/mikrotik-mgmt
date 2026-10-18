import type { PublicRouter } from '@/types';

import { routerService } from '@/core/services';

import { HotspotVouchersClient } from './vouchers-client';

export const metadata = { title: 'Vouchers' };

export default async function HotspotVouchersPage() {
  const result = await routerService.list({ pageSize: 200 });
  const routers: readonly PublicRouter[] = result.ok ? result.value.items : [];

  return <HotspotVouchersClient initialRouterId={routers[0]?.id ?? ''} routers={routers} />;
}