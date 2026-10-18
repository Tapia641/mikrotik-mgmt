import { redirect } from 'next/navigation';

import type { SessionUser } from '@/types';

import { requireSession } from '@/app/api/_lib/session';

import { DashboardNav } from '@/app/dashboard/_components/dashboard-nav';

async function resolveUser(): Promise<SessionUser | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

export default async function HotspotLayout({ children }: { readonly children: React.ReactNode }) {
  const user = await resolveUser();
  if (user === null) redirect('/login');

  return (
    <div className="min-h-screen bg-surface">
      <DashboardNav user={user} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}