'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import type { SessionUser } from '@/types';

import { apiRequest, messageOf } from '@/app/_lib/api-client';

/**
 * Navegacion del panel. Es cliente porque resalta la ruta activa y porque el
 * cierre de sesion debe poder limpiar la cookie desde el navegador.
 *
 * Enlaces de hotspot incluidos: en esta fase las paginas existen como
 * esqueleto, pero la navegacion completa evita tener que volver a tocar el
 * shell en cada PR.
 */

const LINKS = [
  { href: '/dashboard', label: 'Panel' },
  { href: '/dashboard/routers', label: 'Routers' },
  { href: '/dashboard/monitoring', label: 'Monitoreo' },
  { href: '/hotspot/users', label: 'Usuarios' },
  { href: '/hotspot/profiles', label: 'Perfiles' },
  { href: '/hotspot/active', label: 'Activos' },
  { href: '/hotspot/vouchers', label: 'Vouchers' },
  { href: '/dashboard/reports', label: 'Reportes' },
] as const;

const ROLE_LABELS: Readonly<Record<SessionUser['role'], string>> = {
  owner: 'Propietario',
  admin: 'Administrador',
  operator: 'Operador',
  reseller: 'Revendedor',
  viewer: 'Consulta',
};

export interface DashboardNavProps {
  readonly user: SessionUser;
}

export function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await apiRequest<unknown>('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch (cause) {
      setError(messageOf(cause));
      setPending(false);
    }
  }

  return (
    <header className="border-b border-border-subtle bg-surface-elevated">
      <nav
        aria-label="Navegacion principal"
        className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-1 gap-y-2 px-6 py-3"
      >
        <span className="mr-3 text-sm font-bold text-brand-700">MikroTik Manager</span>

        {LINKS.map((link) => {
          // `/dashboard` es prefijo de todas las demas secciones: solo cuenta
          // como activo en coincidencia exacta.
          const active =
            pathname === link.href ||
            (link.href !== '/dashboard' && pathname.startsWith(`${link.href}/`));

          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
                active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-surface-muted'
              }`}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          );
        })}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {user.username} · {ROLE_LABELS[user.role]}
          </span>
          <button
            className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:opacity-60"
            disabled={pending}
            onClick={() => void logout()}
            type="button"
          >
            {pending ? 'Saliendo...' : 'Cerrar sesion'}
          </button>
        </div>
      </nav>

      {error !== null && (
        <p className="bg-danger/5 px-6 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
