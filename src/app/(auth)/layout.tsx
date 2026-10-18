import type { ReactNode } from 'react';

/**
 * Layout del grupo de rutas de autenticacion `(auth)`.
 * El grupo no agrega segmento de URL: `(auth)/login` se sirve en `/login`.
 */
export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
