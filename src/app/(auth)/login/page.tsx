import type { Metadata } from 'next';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Iniciar sesion' };

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** Ruta interna de retorno; cualquier otra cosa cae al dashboard. */
function safeNext(value: string | undefined): string {
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) {
    return '/dashboard';
  }

  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const rawNext = params.next;
  const next = safeNext(Array.isArray(rawNext) ? rawNext[0] : rawNext);

  return (
    <section className="rounded-xl border border-border-subtle bg-surface-elevated p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">MikroTik Web Manager</h1>
      <p className="mt-1 text-sm text-slate-500">
        Accede para gestionar routers, hotspot y vouchers.
      </p>

      <LoginForm next={next} />
    </section>
  );
}
