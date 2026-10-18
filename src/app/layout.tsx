import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'MikroTik Web Manager',
    template: '%s · MikroTik Web Manager',
  },
  description:
    'Panel web para la gestion de Hotspot MikroTik: routers, vouchers, perfiles y reportes.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen bg-surface font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
