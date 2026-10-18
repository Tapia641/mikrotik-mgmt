import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import type { SessionUser } from '@/types';

import { requireSession } from '@/app/api/_lib/session';

import { DashboardNav } from './_components/dashboard-nav';

/**
 * Shell del panel autenticado.
 *
 * El proxy ya exige una cookie firmada para `/dashboard/*`, pero aqui se vuelve
 * a resolver la sesion (autoridad real) y, si ya no vale —expiro, se revoco—, se
 * redirige a `/login` en lugar de renderizar una pagina a medias.
 */

async function resolveUser(): Promise<SessionUser | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { readonly children: ReactNode }) {
  const user = await resolveUser();
  if (user === null) redirect('/login');

  return (
    <div className="min-h-screen bg-surface">
      <DashboardNav user={user} />
      <main className="mx-auto max-w-7xl">{children}</main>
    </div>
  );
}
